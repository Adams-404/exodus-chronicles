import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import StartGame, {
    DIFFICULTIES, EventBus, EVT,
    type Difficulty, type DifficultyConfig, type GamePhase, type SfxName,
} from './game/main';

export interface IRefPhaserGame {
    game: Phaser.Game | null;
    scene: Phaser.Scene | null;
}

type Phases = 'BOOT' | 'MENU' | 'PLAYING' | 'RESULT' | 'PAUSED' | 'WIN' | 'LOSS';

interface ResourceSet { food: number; water: number; safety: number; morale: number }

type FamilyId = 'elder' | 'guardian' | 'caregiver' | 'youth';

interface FamilyMember {
    id: FamilyId;
    name: string;
    role: string;
    short: string;
    status: 'active' | 'weary' | 'lost';
}

const FAMILY: FamilyMember[] = [
    { id: 'elder', name: 'Tariq', role: 'Elder', short: 'El', status: 'active' },
    { id: 'guardian', name: 'Nadia', role: 'Guardian', short: 'Gu', status: 'active' },
    { id: 'caregiver', name: 'Kael', role: 'Caregiver', short: 'Ca', status: 'active' },
    { id: 'youth', name: 'Amina', role: 'Youth', short: 'Yo', status: 'active' },
];

// Choice trade-off application: {res: 'food'|'water'|'safety'|'morale', delta:number}
interface ChoiceResult { res: keyof ResourceSet; delta: number }

interface DecisionChoice {
    label: string;
    hint: string;
    results: ChoiceResult[];
    sub?: string;
}
interface DecisionEvent {
    title: string;
    text: string;
    choices: DecisionChoice[];
    outcome: (s: string[]) => string;
}

type Biomes = 'Arid Badlands' | 'Rocky Pass' | 'Whispering Woods' | 'Coastal Haven Valley';
const BIOMES: Biomes[] = ['Arid Badlands', 'Rocky Pass', 'Whispering Woods', 'Coastal Haven Valley'];

// ---------------------------------------------------------------------------
// EVENT POOL (20+ distinct dilemmas) — every event carries real trade-offs.
// ---------------------------------------------------------------------------

const EVENTS: DecisionEvent[] = [
    {
        title: 'The Abandoned Well',
        text: 'A rusted well stands by the trail. Rope hangs from the pulley, slowed by the dry air of the Arid Badlands. Clear water glints far below — but the rope is frayed and glimpsed. Every one of you is thirsty.',
        choices: [
            { label: 'Lower the bucket', hint: 'Clear water · rope may snap', results: [
                { res: 'water', delta: 18 }, { res: 'safety', delta: -8 },
            ] },
            { label: 'Boil murky puddle', hint: 'Safe water · costs fuel & time', results: [
                { res: 'water', delta: 8 }, { res: 'food', delta: -4 }, { res: 'morale', delta: 3 },
            ], sub: 'Kael steadies the fire.' },
            { label: 'Move on', hint: 'Keeps pace · thirst deepens', results: [
                { res: 'water', delta: -6 }, { res: 'morale', delta: -2 },
            ] },
        ],
        outcome: () => 'The party drinks what they can, and the road stretches on beneath a skies made of bronze.',
    },
    {
        title: 'The Wandering Stranger',
        text: 'A lone traveler rises from behind a dune, arms open and palms showing. They are dusty, thin, and know a shortcut to the spring — if you share what little you carry.',
        choices: [
            { label: 'Share rations', hint: 'Their guidance · lose food', results: [
                { res: 'food', delta: -10 }, { res: 'water', delta: 12 }, { res: 'morale', delta: 6 },
            ], sub: 'Amina waves as they part.' },
            { label: 'Polite distance', hint: 'Keep supplies · slower route', results: [
                { res: 'food', delta: 0 }, { res: 'safety', delta: 5 },
            ] },
            { label: 'Trade a keepsake', hint: 'Keep food · lose a prized token', results: [
                { res: 'food', delta: 4 }, { res: 'morale', delta: -7 },
            ] },
        ],
        outcome: () => 'Trust and caution each find their moment. The group walks on, a little wiser.',
    },
    {
        title: 'Sudden Dust Storm',
        text: 'A wall of ochre rises fast on the horizon. There is no shelter but the sharp teeth of a rocky alcove — or you can press on with cloth wrapped across your faces.',
        choices: [
            { label: 'Shelter in alcove', hint: 'Safe · costs a day of food', results: [
                { res: 'safety', delta: 16 }, { res: 'food', delta: -8 }, { res: 'water', delta: -4 },
            ] },
            { label: 'Push through', hint: 'Keep pace · gifts & hides sting', results: [
                { res: 'safety', delta: -10 }, { res: 'morale', delta: -6 },
            ], sub: 'Nadia shields the young ones with her coat.' },
            { label: 'Hide in the wagon bed', hint: 'Quick shelter · cramped, cold', results: [
                { res: 'safety', delta: 6 }, { res: 'morale', delta: -4 },
            ] },
        ],
        outcome: () => 'When the wind finally drops, the sky is clean and enormous, and you are still standing.',
    },
    {
        title: 'Crossroads at the Broken Bridge',
        text: 'The old bridge has crumpled into the gorge. Three ways forward: a long and quiet detour through the Whispering Woods, a shallow ford across the river, or planks to bridge the gap.',
        choices: [
            { label: 'Detour through woods', hint: 'Safest · slow, eerie quiet', results: [
                { res: 'safety', delta: 12 }, { res: 'morale', delta: -3 }, { res: 'food', delta: -5 },
            ] },
            { label: 'Ford the shallow river', hint: 'Fast · cold water, risk', results: [
                { res: 'water', delta: 6 }, { res: 'safety', delta: -7 },
            ] },
            { label: 'Scavenge planks', hint: 'Use time · keep pace safely', results: [
                { res: 'food', delta: -4 }, { res: 'safety', delta: 8 },
            ], sub: 'Kael and Tariq lash the boards tight.' },
        ],
        outcome: () => 'On the far side of the water, all four of you rest a moment and share one smile.',
    },
    {
        title: 'The Abandoned Orchard',
        text: 'Bent apple and fig trees survive behind a collapsing wall. High fruit gleams out of reach; fallen figs lie underfoot, soft and uncertain. The sun is high and the afternoon is short.',
        choices: [
            { label: 'Climb for high fruit', hint: 'Ripe food · effort & time', results: [
                { res: 'food', delta: 14 }, { res: 'safety', delta: -4 }, { res: 'morale', delta: 4 },
            ] },
            { label: 'Gather fallen figs', hint: 'Quick food · many are spoiled', results: [
                { res: 'food', delta: 5 }, { res: 'water', delta: 4 },
            ] },
            { label: 'Scout ahead', hint: 'Keep time · empty bellies', results: [
                { res: 'food', delta: -3 }, { res: 'safety', delta: 6 },
            ] },
        ],
        outcome: () => 'The orchard drops behind you into evening, filling a few pockets and a little hope.',
    },
    {
        title: 'Night Chill',
        text: 'The temperature falls like a stone. Wood is scarce, but the wrecked cart ahead holds dried planks. The choice is warmth tonight or fuel for the days to come.',
        choices: [
            { label: 'Burn the planks', hint: 'Warm tonight · no fuel later', results: [
                { res: 'morale', delta: 12 }, { res: 'food', delta: -4 }, { res: 'safety', delta: 6 },
            ], sub: 'Tariq hums a low song by the flames.' },
            { label: 'Huddle together', hint: 'Conserve fuel · cold and cramped', results: [
                { res: 'morale', delta: -6 }, { res: 'safety', delta: 4 }, { res: 'food', delta: 0 },
            ] },
            { label: 'Keep a night watch', hint: 'Alert to danger · all stay cold', results: [
                { res: 'safety', delta: 10 }, { res: 'morale', delta: -5 },
            ], sub: 'Nadia takes the first watch, quiet and steady.' },
        ],
        outcome: () => 'Dawn finds you tired but intact, steam curling off your breath into the pale gold light.',
    },
    {
        title: 'The Passing Caravan',
        text: 'A mule train crests the rise, laden with canvas sacks and crates. Their leader names a high price for grain and water — but they might also simply be passing through.',
        choices: [
            { label: 'Barter supplies', hint: 'Grain & water · pay dearly', results: [
                { res: 'food', delta: 12 }, { res: 'water', delta: 10 }, { res: 'morale', delta: -5 },
            ], sub: 'Kael trades salt and a spare pot.' },
            { label: 'Ask directions only', hint: 'Good route · no supplies', results: [
                { res: 'safety', delta: 6 }, { res: 'food', delta: -3 },
            ] },
            { label: 'Share camp quietly', hint: 'Companionship · morning trade', results: [
                { res: 'morale', delta: 10 }, { res: 'safety', delta: 6 }, { res: 'food', delta: -4 },
            ] },
        ],
        outcome: () => 'The caravan vanishes into the haze, and the road is yours alone again beneath the climbing sun.',
    },
    {
        title: 'Scorched Plain Horizon',
        text: 'The plain ahead is bare and blinding, with no shade until the far rocks. Travel by night to avoid the worst heat, or endure the blistering noon and keep distance.',
        choices: [
            { label: 'Travel by starlight', hint: 'Cool air · cold, disorienting', results: [
                { res: 'safety', delta: 8 }, { res: 'morale', delta: -6 }, { res: 'water', delta: -4 },
            ], sub: 'Amina names the constellations.' },
            { label: 'Endure the noon sun', hint: 'Keep pace · burns rations', results: [
                { res: 'safety', delta: -9 }, { res: 'water', delta: -8 },
            ] },
        ],
        outcome: () => 'Somewhere in the shimmer the plain finally ends, and the shade of the foothills swallows you whole.',
    },
    {
        title: 'Hidden Mountain Spring',
        text: 'Behind a curtain of rock, cold water whispers. It is a full spring, clean and sweet. Do you stop to fill every canteen, or drink quickly and keep your lead on the road?',
        choices: [
            { label: 'Fill every canteen', hint: 'Abundant water · spend half a day', results: [
                { res: 'water', delta: 24 }, { res: 'food', delta: -6 }, { res: 'morale', delta: 5 },
            ], sub: 'Nadia cups water for the young ones.' },
            { label: 'Drink and push on', hint: 'Quick relief · keep distance', results: [
                { res: 'water', delta: 6 }, { res: 'safety', delta: 4 },
            ] },
        ],
        outcome: () => 'The spring sings behind you as you climb, and the canteens swing full and heavy and good.',
    },
    {
        title: 'The Fallen Waystation',
        text: 'A waystation stands abandoned, its door ajar. Inside, dry blankets line the wall, and the grain bins long ago went bare. Respect and need sit side by side on the threshold.',
        choices: [
            { label: 'Take the blankets', hint: 'Warm nights · heavy packs', results: [
                { res: 'morale', delta: 8 }, { res: 'safety', delta: 6 }, { res: 'food', delta: -3 },
            ] },
            { label: 'Search the grain bins', hint: 'A few stale fills · time lost', results: [
                { res: 'food', delta: 9 }, { res: 'safety', delta: -3 },
            ] },
            { label: 'Leave it untouched', hint: 'Hold to respect · gain nothing', results: [
                { res: 'morale', delta: 4 }, { res: 'food', delta: -2 },
            ] },
        ],
        outcome: () => 'Whatever you carry out, you close the door gently behind you on the quiet dark.',
    },
    {
        title: 'The Smoking Rift',
        text: 'A dry, scorched canyon crosses the path. Faint smoke rises between sharp rocks, and the air trembles with heat. A great detour would cost you a day.',
        choices: [
            { label: 'Take the long way', hint: 'Safe crossing · a hard day', results: [
                { res: 'safety', delta: 12 }, { res: 'food', delta: -8 }, { res: 'water', delta: -5 },
            ] },
            { label: 'Pick a careful line', hint: 'Risk the heat · keep pace', results: [
                { res: 'safety', delta: -10 }, { res: 'water', delta: -6 },
            ] },
        ],
        outcome: () => 'The canyon hisses behind you and the trail opens onto a cooler ridgeline.',
    },
    {
        title: 'The Quiet Market',
        text: 'A small settlement has pitched stalls by the trail — herbs, leather, bread still warm. The prices are fair, and the people seem kind, if watchful.',
        choices: [
            { label: 'Buy bread and herbs', hint: 'Fresh food · spend stores', results: [
                { res: 'food', delta: 13 }, { res: 'water', delta: 4 }, { res: 'morale', delta: 6 },
            ] },
            { label: 'Trade mended gear', hint: 'A fair trade · time', results: [
                { res: 'safety', delta: 7 }, { res: 'morale', delta: 3 }, { res: 'food', delta: -3 },
            ], sub: 'Kael mends a strap and is paid in dried fruit.' },
            { label: 'Pass them by', hint: 'Keep moving · no burden', results: [
                { res: 'food', delta: -2 }, { res: 'water', delta: -3 },
            ] },
        ],
        outcome: () => 'The settlement shrinks behind you, and the smell of warm bread stays in your memory for miles.',
    },
    {
        title: 'The Slowing Pace',
        text: 'Your steps grow heavy. Fatigue settles into the group like evening. Let the youth lead and sing, or guard her strength and share the load more evenly.',
        choices: [
            { label: 'Let Amina lead and sing', hint: 'Bright spirits · she tires', results: [
                { res: 'morale', delta: 10 }, { res: 'water', delta: -4 },
            ], sub: 'Her little voice lifts everyone.' },
            { label: 'Share the load evenly', hint: 'Steady group · slow going', results: [
                { res: 'safety', delta: 6 }, { res: 'morale', delta: 2 }, { res: 'food', delta: -3 },
            ] },
        ],
        outcome: () => 'The rhythm returns to your feet, and the horizon keeps its promise a little longer.',
    },
    {
        title: 'The Watchful Signs',
        text: 'Scratched markers appear on the stones — warnings or help, you cannot tell. A gesture toward a shortcut, or a trap for the foolish. Nadia reads them carefully.',
        choices: [
            { label: 'Trust the shortcut', hint: 'Gain ground · unknown risk', results: [
                { res: 'safety', delta: -9 }, { res: 'food', delta: 5 },
            ] },
            { label: 'Ignore the marks', hint: 'Safe route · slower', results: [
                { res: 'safety', delta: 8 }, { res: 'water', delta: -4 },
            ], sub: 'Nadia shoulders the packs and moves on.' },
        ],
        outcome: () => 'You leave the marked stones behind, deciding to trust your own feet over painted warnings.',
    },
    {
        title: 'The Stray Dog',
        text: 'A gaunt dog follows you from the last town, limping slightly, refusing to be left. Feeding it costs you; turning it away costs you something else entirely.',
        choices: [
            { label: 'Share meals with it', hint: 'Warm company · a little food', results: [
                { res: 'morale', delta: 8 }, { res: 'food', delta: -6 }, { res: 'safety', delta: 4 },
            ] },
            { label: 'Leave it by the gate', hint: 'Keep your stores · a sore heart', results: [
                { res: 'morale', delta: -6 }, { res: 'food', delta: 2 },
            ] },
        ],
        outcome: () => 'Whatever choice you made, the road makes no judgement; it only asks that you keep walking.',
    },
    {
        title: 'The Cooling Breeze From the Vale',
        text: 'The air softens as the Coastal Haven Valley comes into view far below. Somewhere down there is the safe haven. Your pace quickens — you are almost there.',
        choices: [
            { label: 'Push hard toward the haven', hint: 'Fast finish · last mile weary', results: [
                { res: 'safety', delta: 5 }, { res: 'water', delta: -8 }, { res: 'morale', delta: 8 },
            ] },
            { label: 'Rest in the tall grass', hint: 'Recover now · slower finish', results: [
                { res: 'morale', delta: 10 }, { res: 'water', delta: 4 }, { res: 'food', delta: -3 },
            ] },
            { label: 'Set a careful camp', hint: 'Safe night · calm arrival', results: [
                { res: 'safety', delta: 9 }, { res: 'food', delta: -4 },
            ] },
        ],
        outcome: () => 'Below you, the valley glows soft and golden, and the end of the long walk is finally in reach.',
    },
];

// ---------------------------------------------------------------------------
// JOURNEY ENGINE — one step per day.
// ---------------------------------------------------------------------------

interface OutcomeSummary {
    day: number;
    lines: string[];
    dayLabel: string;
    special: string | null;
}

function buildOutcomeSummary(
    result: { title: string; dayLabel: string; results: ChoiceResult[]; sub?: string; outcome: string },
    before: ResourceSet,
): OutcomeSummary {
    const lines: string[] = [];
    if (result.sub) lines.push(result.sub);
    if (result.results.some((r) => r.delta !== 0)) {
        const gains = result.results.filter((r) => r.delta > 0);
        const losses = result.results.filter((r) => r.delta < 0);
        if (gains.length) lines.push('Gained: ' + gains.map((g) => `${cap(g.res)} +${g.delta}`).join(', '));
        if (losses.length) lines.push('Spent: ' + losses.map((l) => `${cap(l.res)} ${l.delta}`).join(', '));
    }
    void before;
    lines.push(result.outcome);
    return { day: 0, lines, dayLabel: result.dayLabel, special: null };
}

function cap(res: keyof ResourceSet): string {
    switch (res) {
        case 'food': return 'Food';
        case 'water': return 'Water';
        case 'safety': return 'Safety';
        case 'morale': return 'Morale';
    }
}

// ---------------------------------------------------------------------------
// APP SHELL
// ---------------------------------------------------------------------------

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const [phase, setPhase] = useState<GamePhase>('BOOT');
    const [difficulty, setDifficulty] = useState<Difficulty>('medium');
    const [difficultyKey, setDifficultyKey] = useState<Difficulty>('medium');
    const [resources, setResources] = useState<ResourceSet>(DIFFICULTIES.medium.start);
    const [family, setFamily] = useState<FamilyMember[]>(() =>
        FAMILY.map((m) => ({ ...m })));
    const [day, setDay] = useState(0);
    const [currentEvent, setCurrentEvent] = useState<DecisionEvent | null>(null);
    const [outcome, setOutcome] = useState<OutcomeSummary | null>(null);
    const [log, setLog] = useState<string[]>([]);
    const [mutedUi, setMutedUi] = useState(false);
    const [usedEvents, setUsedEvents] = useState<number[]>([]);
    const [lossCause, setLossCause] = useState<string>('');

    const stateRef = useRef({ phase });
    stateRef.current.phase = phase;

    const bus = useCallback((name: string, payload?: unknown) =>
        EventBus.emit(name, payload), []);

    const playSfx = useCallback((sound: SfxName) =>
        EventBus.emit(EVT.PLAY_SFX, { sound }), []);

    // ----- mascot: the Phaser scene -------------------------------------
    useLayoutEffect(() => {
        if (phaserRef.current === null) {
            const game = StartGame('game-container');
            phaserRef.current = { game, scene: null };
        }
        const handler = (scene: Phaser.Scene) => {
            if (phaserRef.current) phaserRef.current.scene = scene;
        };
        EventBus.on(EVT.CURRENT_SCENE_READY, handler);
        // boot -> menu
        const bootTimer = window.setTimeout(() => setPhase('MENU'), 1200);
        return () => {
            window.clearTimeout(bootTimer);
            EventBus.removeListener(EVT.CURRENT_SCENE_READY, handler);
            if (phaserRef.current) {
                phaserRef.current.game?.destroy(true);
                phaserRef.current = null;
            }
        };
    }, []);

    // emit phase changes to Phaser (drives any scene-side reactions)
    useEffect(() => {
        if (phase !== 'BOOT') EventBus.emit(EVT.PHASE_CHANGED, phase);
    }, [phase, bus]);

    // keep Phaser in sync with journey + resources whenever they change
    useEffect(() => {
        if (phase === 'PLAYING' || phase === 'RESULT') {
            const cfg = DIFFICULTIES[difficultyKey];
            const ratio = day / Math.max(1, cfg.days);
            const biome = BIOMES[Math.min(BIOMES.length - 1, Math.max(0,
                Math.floor(ratio * BIOMES.length)))];
            EventBus.emit(EVT.JOURNEY_UPDATED, { day, maxDays: cfg.days, progressRatio: ratio, biome });
        }
    }, [day, phase, difficultyKey]);

    useEffect(() => {
        if (phase === 'PLAYING' || phase === 'RESULT') {
            EventBus.emit(EVT.RESOURCE_UPDATED, resources);
        }
    }, [resources, phase]);

    const scene = (): { pauseWorld: () => void; resumeWorld: () => void; toggleMute: () => boolean } | null =>
        phaserRef.current?.scene as unknown as
            { pauseWorld: () => void; resumeWorld: () => void; toggleMute: () => boolean } | null;

    // ----- global keyboard ----------------------------------------------
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const ph = stateRef.current.phase;
            if (ph === 'MENU') {
                if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); beginJourney(); }
            } else if (ph === 'PLAYING') {
                if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { e.preventDefault(); openPause(); }
                else if (e.key === 'm' || e.key === 'M') toggSound();
                else if (e.key === '1') choose(0);
                else if (e.key === '2') choose(1);
                else if (e.key === '3') choose(2);
            } else if (ph === 'PAUSED') {
                if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { e.preventDefault(); closePause(); }
                else if (e.key === 'm' || e.key === 'M') toggSound();
            } else if (ph === 'RESULT') {
                if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advanceDay(); }
            } else if (ph === 'WIN') {
                if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); replay(); }
            } else if (ph === 'LOSS') {
                if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); retry(); }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    // ----- state transitions --------------------------------------------
    const beginJourney = () => {
        playSfx('sfx_button');
        EventBus.emit(EVT.START_JOURNEY, { difficulty: difficultyKey });
        const cfg = DIFFICULTIES[difficultyKey];
        setResources({ ...cfg.start });
        setFamily(FAMILY.map((m) => ({ ...m })));
        setDay(1);
        setLog([]);
        setUsedEvents([]);
        setLossCause('');
        setOutcome(null);
        setDifficulty(difficultyKey);
        drawEvent(1, cfg);
        setPhase('PLAYING');
        EventBus.emit(EVT.PHASE_CHANGED, 'PLAYING');
    };

    const drawEvent = (d: number, cfg: DifficultyConfig) => {
        // pick an event not recently used, preferring low-resource variants
        const available = EVENTS.map((ev, i) => ({ ev, i }))
            .filter(({ i }) => !usedEvents.includes(i));
        const pool = available.length > 0 ? available : EVENTS.map((ev, i) => ({ ev, i }));
        const ev = pool[Math.floor(Math.random() * pool.length)];
        setCurrentEvent(ev.ev);
        setUsedEvents((p) => [...p.slice(-8), ev.i]);
    };

    const choose = (idx: number) => {
        if (!currentEvent || phase !== 'PLAYING') return;
        const ev = currentEvent;
        const c = ev.choices[idx];
        if (!c) return;
        playSfx('sfx_event');
        const cfg = DIFFICULTIES[difficultyKey];
        const before = resources;
        // apply trade-offs (clamp 0..100)
        const nr: ResourceSet = { ...before };
        c.results.forEach((r) => {
            nr[r.res] = clamp100(nr[r.res] + r.delta);
        });
        // daily natural consumption
        nr.food = clamp100(nr.food + cfg.daily.food);
        nr.water = clamp100(nr.water + cfg.daily.water);
        nr.safety = clamp100(nr.safety + cfg.daily.safety);
        nr.morale = clamp100(nr.morale + cfg.daily.morale);
        setResources(nr);

        const summ = buildOutcomeSummary({
            title: ev.title, dayLabel: `Day ${day} — ${ev.title}`,
            results: c.results, sub: c.sub, outcome: ev.outcome([]),
        }, before);
        setOutcome(summ);
        setPhase('RESULT');
        EventBus.emit(EVT.PHASE_CHANGED, 'RESULT');
    };

    const advanceDay = () => {
        if (phase !== 'RESULT') return;
        playSfx('sfx_button');
        const cfg = DIFFICULTIES[difficultyKey];
        const nextDay = day + 1;
        // loss checks
        const allLost = family.every((m) => m.status === 'lost');
        const starved = resources.water <= 0 && resources.food <= 0;
        if (allLost || starved || resources.safety <= 0) {
            const cause = starved ? 'Provisions ran empty on the open road.' :
                resources.safety <= 0 ? 'The road grew too dangerous to hold the group together.' :
                    'Every voice in the family was lost before the haven came into view.';
            setLossCause(cause);
            setDay(day);
            setOutcome(null);
            setCurrentEvent(null);
            setPhase('LOSS');
            playSfx('sfx_gameover');
            EventBus.emit(EVT.PHASE_CHANGED, 'LOSS');
            return;
        }
        if (nextDay > cfg.days) {
            // reached the haven
            setLog((l) => [...l, `Reached the haven on Day ${day}.`]);
            setOutcome(null);
            setCurrentEvent(null);
            setPhase('WIN');
            playSfx('sfx_win');
            EventBus.emit(EVT.PHASE_CHANGED, 'WIN');
            return;
        }
        setDay(nextDay);
        drawEvent(nextDay, cfg);
        setOutcome(null);
        setPhase('PLAYING');
        EventBus.emit(EVT.PHASE_CHANGED, 'PLAYING');
    };

    const openPause = () => {
        playSfx('sfx_button');
        setPhase('PAUSED');
        query((s) => s.pauseWorld());
        EventBus.emit(EVT.PHASE_CHANGED, 'PAUSED');
    };

    const closePause = () => {
        playSfx('sfx_button');
        query((s) => s.resumeWorld());
        setPhase((stateRef.current.phase === 'PAUSED' && day > 0) ? (
            outcome ? 'RESULT' : 'PLAYING') : 'PLAYING');
        EventBus.emit(EVT.PHASE_CHANGED,
            outcome ? 'RESULT' : 'PLAYING');
    };

    const query = (fn: (s: NonNullable<ReturnType<typeof scene>>) => void) => {
        const s = scene();
        if (s) fn(s);
    };

    const toggSound = () => {
        const s = scene();
        const nowMuted = s ? s.toggleMute() : !mutedUi;
        if (!s) setMutedUi(nowMuted);
        else setMutedUi(nowMuted);
    };

    const replay = () => {
        playSfx('sfx_button');
        query((s) => s.resumeWorld());
        EventBus.emit(EVT.RESTART_JOURNEY);
        beginJourney();
    };

    const retry = () => {
        playSfx('sfx_button');
        query((s) => s.resumeWorld());
        EventBus.emit(EVT.RESTART_JOURNEY);
        beginJourney();
    };

    const backToMenu = () => {
        playSfx('sfx_button');
        query((s) => s.resumeWorld());
        setPhase('MENU');
        EventBus.emit(EVT.PHASE_CHANGED, 'MENU');
    };

    const survivors = family.filter((m) => m.status !== 'lost');
    const cfg = DIFFICULTIES[difficultyKey];

    const gaugeColor = (v: number) => (v >= 50 ? '#68d391' : v >= 25 ? '#f6ad55' : '#fc8181');

    // ------ phased overlays ---------------------------------------------
    return (
        <div id="app">
            <div id="game-container"></div>
            <div id="hud">
                {phase === 'BOOT' && <BootScreen />}

                {phase === 'MENU' && (
                    <MenuScreen
                        difficulty={difficultyKey}
                        setDifficulty={setDifficultyKey}
                        muted={mutedUi}
                        toggSound={toggSound}
                        begin={beginJourney}
                    />
                )}

                {(phase === 'PLAYING' || phase === 'RESULT') && (
                    <PlayingHud
                        day={day}
                        maxDays={cfg.days}
                        resources={resources}
                        family={family}
                        phase={phase}
                        currentEvent={currentEvent}
                        outcome={outcome}
                        playSfx={playSfx}
                        choose={choose}
                        advance={advanceDay}
                        openPause={openPause}
                        gaugeColor={gaugeColor}
                        difficultyKey={difficultyKey}
                    />
                )}

                {phase === 'PAUSED' && (
                    <PauseScreen
                        close={closePause}
                        toggSound={toggSound}
                        muted={mutedUi}
                        replay={replay}
                        menu={backToMenu}
                    />
                )}

                {phase === 'WIN' && (
                    <EndScreen
                        title="The Safe Haven"
                        tone="win"
                        difficultyKey={difficultyKey}
                        day={day}
                        resources={resources}
                        survivors={survivors}
                        family={family}
                        onPrimary={replay}
                        onMenu={backToMenu}
                        lossCause={lossCause}
                    />
                )}

                {phase === 'LOSS' && (
                    <EndScreen
                        title="The Road Ended Here"
                        tone="loss"
                        difficultyKey={difficultyKey}
                        day={day}
                        resources={resources}
                        survivors={survivors}
                        family={family}
                        onPrimary={retry}
                        onMenu={backToMenu}
                        lossCause={lossCause}
                    />
                )}
            </div>
        </div>
    );
}

function clamp100(v: number) { return Math.max(0, Math.min(100, v)); }

// ---------------------------------------------------------------------------
// SCREEN COMPONENTS
// ---------------------------------------------------------------------------

function BootScreen() {
    return (
        <div className="overlay boot">
            <div className="brandmark">
                <span className="boot-dot" />
                <span className="boot-title">The Long Walk</span>
                <span className="boot-sub">kindling a small hope</span>
            </div>
        </div>
    );
}

interface MenuProps {
    difficulty: Difficulty; setDifficulty: (d: Difficulty) => void;
    muted: boolean; toggSound: () => void; begin: () => void;
}
function MenuScreen({ difficulty, setDifficulty, muted, toggSound, begin }: MenuProps) {
    return (
        <div className="overlay menu">
            <div className="menu-scroll">
                <h1 className="game-title">The Long Walk</h1>
                <p className="game-tagline">
                    War and ruin closed the road behind you. Ahead, a distant haven.
                    Four of you walk, rationing hope as carefully as water.
                </p>
                <div className="difficulty-row">
                    {(Object.keys(DIFFICULTIES) as Difficulty[]).map((k) => {
                        const d = DIFFICULTIES[k];
                        return (
                            <button
                                key={k}
                                className={`diff-card${difficulty === k ? ' active' : ''}`}
                                onClick={() => { setDifficulty(k); }}
                                style={{ borderColor: difficulty === k ? d.tone : '#ffffff22' }}
                                tabIndex={0}
                            >
                                <span className="diff-name">{d.label}</span>
                                <span className="diff-days">{d.days} days</span>
                                <span className="diff-desc">{d.descriptor}</span>
                            </button>
                        );
                    })}
                </div>
                <button className="primary-btn begin" onClick={begin}>
                    Begin Journey
                </button>
                <p className="key-hint">tap the card, then Begin · or press Space / Enter</p>
                <button className="icon-btn sound-toggle" onClick={toggSound}
                    title="Toggle sound (M)">
                    {muted ? '🔇 Sound Off' : '🔊 Sound On'}
                </button>
            </div>
        </div>
    );
}

interface HudProps {
    day: number; maxDays: number; resources: ResourceSet; family: FamilyMember[];
    phase: GamePhase; currentEvent: DecisionEvent | null; outcome: OutcomeSummary | null;
    playSfx: (s: SfxName) => void; choose: (i: number) => void; advance: () => void;
    openPause: () => void; gaugeColor: (v: number) => string; difficultyKey: Difficulty;
}
function PlayingHud(props: HudProps) {
    const { day, maxDays, resources, family, currentEvent, outcome, phase } = props;
    const progress = Math.min(1, day / maxDays);
    return (
        <div className="hud">
            <div className="hud-top">
                <div className="journey-bar">
                    <div className="journey-fill" style={{ width: `${progress * 100}%` }} />
                    <span className="journey-marker" style={{ left: `${progress * 100}%` }} />
                    <span className="journey-label">Day {day} of {maxDays}</span>
                    <span className="journey-beacon">🏠</span>
                </div>
                <button className="icon-btn pause-btn" onClick={props.openPause} title="Pause (ESC)">⏸</button>
            </div>

            <div className="res-grid">
                {(['food', 'water', 'safety', 'morale'] as const).map((k) => (
                    <Gauge key={k} label={cap(k)} value={resources[k]} color={props.gaugeColor(resources[k])} />
                ))}
            </div>

            <div className="family-bar">
                {family.map((m) => (
                    <div key={m.id} className={`fam-token ${m.status}`}>
                        <span className="fam-avatar">{m.short}</span>
                        <span className="fam-name">{m.name}</span>
                    </div>
                ))}
            </div>

            {phase === 'PLAYING' && currentEvent && (
                <div className="event-card">
                    <h2 className="event-title">{currentEvent.title}</h2>
                    <p className="event-text">{currentEvent.text}</p>
                    <div className="choice-list">
                        {currentEvent.choices.map((c, i) => (
                            <button
                                key={i}
                                className="choice-btn"
                                onClick={() => props.choose(i)}
                            >
                                <span className="choice-num">{i + 1}</span>
                                <span className="choice-body">
                                    <span className="choice-label">{c.label}</span>
                                    <span className="choice-hint">{c.hint}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {phase === 'RESULT' && outcome && (
                <div className="result-card">
                    <h2 className="result-day">{outcome.dayLabel}</h2>
                    <ul className="result-lines">
                        {outcome.lines.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                    <button className="primary-btn continue-btn" onClick={props.advance}>
                        Continue Day {day + 1}
                    </button>
                </div>
            )}
        </div>
    );
}

function Gauge({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className={`gauge ${value < 22 ? 'critical' : ''}`}>
            <div className="gauge-head"><span className="gauge-name">{label}</span><span className="gauge-val">{value}</span></div>
            <div className="gauge-track">
                <div className="gauge-fill" style={{ width: `${value}%`, background: color }} />
            </div>
        </div>
    );
}

interface PauseProps {
    close: () => void; toggSound: () => void; muted: boolean;
    replay: () => void; menu: () => void;
}
function PauseScreen({ close, toggSound, muted, replay, menu }: PauseProps) {
    return (
        <div className="overlay pause">
            <div className="panel">
                <h2>Paused</h2>
                <button className="primary-btn" onClick={close}>Resume</button>
                <button className="secondary-btn" onClick={toggSound}>{muted ? '🔇 Unmute (M)' : '🔊 Mute (M)'}</button>
                <button className="secondary-btn" onClick={replay}>Restart</button>
                <button className="secondary-btn danger" onClick={menu}>Return to Menu</button>
            </div>
        </div>
    );
}

interface EndProps {
    title: string; tone: 'win' | 'loss'; difficultyKey: Difficulty;
    day: number; resources: ResourceSet; survivors: FamilyMember[];
    family: FamilyMember[]; onPrimary: () => void; onMenu: () => void; lossCause: string;
}
function EndScreen({ title, tone, difficultyKey, day, resources, survivors, family, onPrimary, onMenu, lossCause }: EndProps) {
    const cfg = DIFFICULTIES[difficultyKey];
    const names = survivors.length ? survivors.map((s) => s.name).join(', ') : 'none';
    return (
        <div className={`overlay end ${tone}`}>
            <div className="panel">
                <span className="end-emoji">{tone === 'win' ? '🏠🌅' : '🌙'}</span>
                <h2 className="end-title">{title}</h2>
                {tone === 'win' ? (
                    <>
                        <p className="end-msg">
                            After {day} long days beneath an open sky, you reach the Coastal Haven Valley.
                            Warm threshholds, cool water, and a place to rest at last.
                        </p>
                        <p className="end-msg">
                            <strong>{names}</strong> arrived safely, carrying what could not be left behind:
                            each other. Remaining provisions — food {resources.food}, water {resources.water}.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="end-msg">
                            The road was too hard this time. But their courage endures.
                        </p>
                        <p className="end-msg cause">{lossCause}</p>
                        <p className="end-msg">
                            They held together for {day} days. {names}
                            {names === 'none' ? '' : ' remain'} — and the trail remembers their steps.
                        </p>
                    </>
                )}
                <div className="journey-log">
                    <strong>Never forgotten</strong>
                    <div className="log-fam">
                        {family.map((m) => (
                            <span key={m.id} className={`log-tag ${m.status}`}>{m.name}</span>
                        ))}
                    </div>
                    {cfg.label} · {day} days · {survivors.length} of {family.length} reached the gate
                </div>
                <button className="primary-btn replay-btn" onClick={onPrimary}>
                    {tone === 'win' ? 'Play Again' : 'Try Again'}
                </button>
                <button className="secondary-btn" onClick={onMenu}>Return to Menu</button>
                <p className="key-hint">press Space / Enter</p>
            </div>
        </div>
    );
}

export default App;