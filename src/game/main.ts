import { AUTO, BlendModes, Events, Game as PhaserGame, Scale, Scene, TintModes } from 'phaser';
import type Phaser from 'phaser';

// ---------------------------------------------------------------------------
// GAME CONSTANTS — inline here; do NOT create a constants.ts file.
// Portrait 540x960 (9:16 mobile-first).
// ---------------------------------------------------------------------------
export const GAME_WIDTH = 540;
export const GAME_HEIGHT = 960;

export const COLORS = {
    SKY_TOP: 0x2b1d14,
    SKY_MID: 0x4a2c1d,
    SKY_HORIZON: 0xb36b3c,
    HILL_1: 0x4a2c1d,
    HILL_2: 0x384d3b,
    HILL_3: 0x607c65,
    TERRAIN: 0x2b1d14,
    GROUND: 0x4a2c1d,
    SILHOUETTE: 0x1a1410,
    DUST: 0xd97d43,
    STARLIGHT: 0xfaf089,
    GOLD: 0xf6ad55,
    TEXT: '#f7fafc',
} as const;

// Difficulty display tiers
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DifficultyConfig {
    key: Difficulty;
    label: string;
    descriptor: string;
    days: number;
    start: { food: number; water: number; safety: number; morale: number };
    daily: { food: number; water: number; safety: number; morale: number };
    tone: string;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
    easy: {
        key: 'easy',
        label: 'Calm Season',
        descriptor: 'A gentle, hopeful crossing',
        days: 8,
        start: { food: 85, water: 85, safety: 80, morale: 85 },
        daily: { food: -6, water: -8, safety: -3, morale: -4 },
        tone: '#68d391',
    },
    medium: {
        key: 'medium',
        label: 'Uncertain Roads',
        descriptor: 'The road tests your resolve',
        days: 12,
        start: { food: 75, water: 75, safety: 70, morale: 75 },
        daily: { food: -8, water: -10, safety: -5, morale: -6 },
        tone: '#f6ad55',
    },
    hard: {
        key: 'hard',
        label: 'Storm Ahead',
        descriptor: 'Hardship sharpens every choice',
        days: 16,
        start: { food: 65, water: 65, safety: 60, morale: 65 },
        daily: { food: -10, water: -12, safety: -7, morale: -8 },
        tone: '#fc8181',
    },
};

// ---------------------------------------------------------------------------
// EVENT NAMES — single source of truth so React and the scene never drift.
// ---------------------------------------------------------------------------
export const EVT = {
    CURRENT_SCENE_READY: 'current-scene-ready',
    PHASE_CHANGED: 'phase-changed',
    JOURNEY_UPDATED: 'journey-updated',
    RESOURCE_UPDATED: 'resource-updated',
    PLAY_SFX: 'play-sfx',
    START_JOURNEY: 'start-journey',
    RESTART_JOURNEY: 'restart-journey',
} as const;

export type GamePhase = 'BOOT' | 'MENU' | 'PLAYING' | 'PAUSED' | 'RESULT' | 'WIN' | 'LOSS';
export type SfxName = 'sfx_button' | 'sfx_win' | 'sfx_gameover' | 'sfx_step' | 'sfx_event';

export interface JourneyUpdate {
    day: number;
    maxDays: number;
    progressRatio: number;
    biome: string;
}

export interface ResourceUpdate {
    food: number;
    water: number;
    safety: number;
    morale: number;
}

// ---------------------------------------------------------------------------
// EVENT BUS — shared React <-> Phaser bridge (named export).
// ---------------------------------------------------------------------------
export const EventBus = new Events.EventEmitter();

// ---------------------------------------------------------------------------
// AUDIO — Name of the actual bundled file for each logical SfxName.
// ---------------------------------------------------------------------------
const SFX_FILES: Record<SfxName, string> = {
    sfx_button: 'assets/audio/sfx_button.mp3',
    sfx_win: 'assets/audio/sfx_win.mp3',
    sfx_gameover: 'assets/audio/sfx_gameover.mp3',
    sfx_step: 'assets/audio/sfx_jump.mp3',
    sfx_event: 'assets/audio/sfx_collect.mp3',
};

// ---------------------------------------------------------------------------
// CODE-GENERATED TEXTURES — small helpers invoked inside create().
// ---------------------------------------------------------------------------

/** Palette-safe hex number. */
function hex(s: string): number {
    // '0x68d391' -> 0x68d391, '#fff' -> 0xffffff
    const c = s.replace('#', '');
    return parseInt(c.length === 3 ? c.split('').map((ch) => ch + ch).join('') : c, 16);
}

// ---------------------------------------------------------------------------
// THE GAME SCENE — owns all Phaser visuals + audio for the whole journey.
// ---------------------------------------------------------------------------
export class Game extends Scene {
    private familySprites: Phaser.GameObjects.Image[] = [];
    private groundTerrain!: Phaser.GameObjects.Image;
    private ambient: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
    private muted = false;

    constructor() {
        super('Game');
    }

    preload() {
        // Universal audio. All files exist under public/assets/audio/.
        (Object.keys(SFX_FILES) as SfxName[]).forEach((name) => {
            this.load.audio(name, SFX_FILES[name]);
        });
        this.load.image('fx_glow', 'assets/fx/glow.png');
        this.load.image('fx_star', 'assets/fx/star.png');
    }

    create() {
        this.drawSky();
        this.drawHorizon();
        this.drawTerrain();
        this.drawWalkers();
        this.spawnAmbientParticles();
        this.wireEventBridge();
        this.input.keyboard?.on('keydown-M', () => this.toggleMute());

        EventBus.emit(EVT.CURRENT_SCENE_READY, this);

        this.events.once('shutdown', () => {
            this.time.removeAllEvents();
            this.tweens.killAll();
            this.input.keyboard?.removeAllListeners();
            this.sound.stopAll();
            EventBus.off(EVT.START_JOURNEY, this.handleStartJourney, this);
            EventBus.off(EVT.RESTART_JOURNEY, this.handleRestartJourney, this);
            EventBus.off(EVT.JOURNEY_UPDATED, this.handleJourney, this);
            EventBus.off(EVT.RESOURCE_UPDATED, this.handleResources, this);
            EventBus.off(EVT.PLAY_SFX, this.handlePlaySfx, this);
        });
    }

    private wireEventBridge() {
        EventBus.on(EVT.START_JOURNEY, this.handleStartJourney, this);
        EventBus.on(EVT.RESTART_JOURNEY, this.handleRestartJourney, this);
        EventBus.on(EVT.JOURNEY_UPDATED, this.handleJourney, this);
        EventBus.on(EVT.RESOURCE_UPDATED, this.handleResources, this);
        EventBus.on(EVT.PLAY_SFX, this.handlePlaySfx, this);
    }

    toggleMute(): boolean {
        this.muted = !this.muted;
        this.sound.mute = this.muted;
        return this.muted;
    }

    // -- visual fabrication -------------------------------------------------

    private drawSky() {
        const g = this.add.graphics();
        // vertical gradient banded by hand
        const bands = 24;
        const top = hex(COLORS.SKY_TOP.toString(16).padStart(6, '0'));
        const mid = hex('4a2c1d');
        const hor = hex('b36b3c');
        for (let i = 0; i < bands; i++) {
            const t = i / (bands - 1);
            const col = t < 0.5
                ? lerpColor(top, mid, t * 2)
                : lerpColor(mid, hor, (t - 0.5) * 2);
            g.fillStyle(col, 1);
            g.fillRect(0, i * (GAME_HEIGHT / bands), GAME_WIDTH, GAME_HEIGHT / bands + 1);
        }
        g.generateTexture('sky', GAME_WIDTH, GAME_HEIGHT);
        g.destroy();
        this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'sky').setDepth(-10);

        // sun disc (gold) low on horizon
        const sun = this.add.circle(390, 620, 46, hex('f6ad55'), 0.55).setDepth(-9);
        this.tweens.add({
            targets: sun,
            alpha: { from: 0.16, to: 0.75 },
            duration: 4000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        // soft stars near the top
        for (let i = 0; i < 26; i++) {
            const s = this.add.image(20 + Math.random() * 500, 20 + Math.random() * 200, 'fx_star');
            s.setDepth(-8).setScale(0.6 + Math.random() * 0.8).setTint(hex('faf089'));
            s.setAlpha(0.25 + Math.random() * 0.45);
            // twinkle on a few
            if (i % 3 === 0) {
                this.tweens.add({
                    targets: s,
                    alpha: { from: 0.15, to: 0.85 },
                    duration: 1400 + Math.random() * 1200,
                    yoyo: true,
                    repeat: -1,
                });
            }
        }
    }

    private drawHorizon() {
        // distant mountain ridgeline
        const m = this.add.graphics();
        m.fillStyle(hex('1a202c'), 1);
        let x = 0;
        m.beginPath();
        m.moveTo(0, GAME_HEIGHT);
        let yd = 620 + Math.random() * 40;
        while (x < GAME_WIDTH) {
            const seg = 40 + Math.random() * 70;
            const peak = 560 + Math.random() * 80;
            m.lineTo(x, yd);
            x += seg;
            yd = peak;
        }
        m.lineTo(GAME_WIDTH, GAME_HEIGHT);
        m.closePath();
        m.fillPath();
        m.generateTexture('ridgeline', GAME_WIDTH, 400);
        m.destroy();
        this.add.image(GAME_WIDTH / 2, 780, 'ridgeline').setDepth(-5).setAlpha(0.9);

        // rolling hills band (slightly closer, paler)
        const h = this.add.graphics();
        h.fillStyle(hex('384d3b'), 1);
        h.fillEllipse(-40, 900, 700, 220);
        h.fillEllipse(300, 930, 640, 240);
        h.generateTexture('hills', GAME_WIDTH, 320);
        h.destroy();
        this.add.image(GAME_WIDTH / 2, 900, 'hills').setDepth(-4);
    }

    private drawTerrain() {
        const g = this.add.graphics();
        g.fillStyle(hex('2b1d14'), 1);
        g.fillRect(0, 0, GAME_WIDTH, 220);
        // a winding path of lighter earth down the screen
        g.fillStyle(hex('4a2c1d'), 1);
        g.fillEllipse(270, 60, 620, 120);
        g.fillEllipse(270, 150, 520, 90);
        g.fillStyle(hex('5a3822'), 1);
        for (let i = 0; i < 40; i++) {
            g.fillCircle(Math.random() * GAME_WIDTH, Math.random() * 220, 2 + Math.random() * 5);
        }
        g.generateTexture('terrain', GAME_WIDTH, 220);
        g.destroy();
        this.groundTerrain = this.add.image(GAME_WIDTH / 2, 850, 'terrain').setDepth(-3);
    }

    // Family silhouettes walking up the path toward the top (the haven).
    private drawWalkers() {
        // generate four small human silhouettes
        const colors = [hex('1a1410'), hex('2b1d14'), hex('241812'), hex('33200f')];
        const sizes = [30, 38, 34, 26];
        for (let i = 0; i < 4; i++) {
            const g = this.add.graphics();
            g.fillStyle(colors[i], 1);
            // head
            g.fillCircle(0, -18, (sizes[i] / 14) * 2.4);
            // torso
            g.fillRoundedRect(-(sizes[i] / 4), -8, sizes[i] / 2, sizes[i] / 2, 3);
            // legs
            g.fillRect(-(sizes[i] / 4), sizes[i] / 2 - 2, 3, sizes[i] / 3);
            g.fillRect(sizes[i] / 4 - 3, sizes[i] / 2 - 2, 3, sizes[i] / 3);
            // staff (elder) or pack
            if (i === 0 || i === 3) g.fillRect(sizes[i] / 3, -20, 2.4, sizes[i]);
            g.generateTexture(`walker${i}`, sizes[i], sizes[i]);
            g.destroy();
        }

        const startY = 930;
        for (let i = 0; i < 4; i++) {
            const sp = this.add.image(120 + i * 66, startY - i * 26,
                `walker${i}`, ).setDepth(2).setTint(hex('241812'));
            // gentle bob — walking
            this.tweens.add({
                targets: sp,
                y: { from: sp.y - 4, to: sp.y + 4 },
                scaleY: { from: 0.97, to: 1.03 },
                duration: 340 + i * 70,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });
            this.familySprites.push(sp);
        }
    }

    private spawnAmbientParticles() {
        this.ambient = this.add.particles(0, 0, 'fx_glow', {
            x: { min: 0, max: GAME_WIDTH },
            y: { min: 100, max: GAME_HEIGHT },
            lifespan: 6000,
            speedY: { min: 12, max: 34 },
            speedX: { min: -18, max: 8 },
            scale: { start: 0.35, end: 0 },
            alpha: { start: 0.3, end: 0 },
            frequency: 320,
            quantity: 1,
            tint: hex('d97d43'),
            blendMode: BlendModes.ADD,
        });
        this.ambient.setDepth(3);
    }

    // -- event handlers from React ------------------------------------------

    private handleStartJourney() {
        this.sound.play('sfx_button', { volume: 0.8 });
        this.tweens.timeScale = 1;
    }

    private handleRestartJourney() {
        this.sound.stopAll();
    }

    private handleJourney(u: JourneyUpdate) {
        // Progress (0..1) moves the silhouettes upward along the path.
        const baseY = 930;
        const climb = baseY - 580 * u.progressRatio;
        const spread = [0, 26, 50, 72];
        this.familySprites.forEach((sp, i) => {
            this.tweens.add({
                targets: sp,
                y: baseY - spread[i] - 560 * u.progressRatio,
                x: 120 + i * 66,
                duration: 900,
                ease: 'Sine.easeOut',
            });
        });
        void climb;
        // Gentle wind streaks when approaching the haven: tint ground gold.
        if (this.groundTerrain) {
            this.groundTerrain.setTintMode(TintModes.FILL);
            this.groundTerrain.setTint(u.progressRatio > 0.8 ? hex('f6ad55') : hex('4a2c1d'));
        }
    }

    private handleResources(r: ResourceUpdate) {
        // Critical (<22) resource turns the ambient dust cooler/stormier.
        const critical = Math.min(r.food, r.water, r.safety, r.morale) < 22;
        this.ambient?.setParticleTint(critical ? hex('718096') : hex('d97d43'));
    }

    private handlePlaySfx(s: { sound: SfxName }) {
        const key = s?.sound as SfxName;
        const file = SFX_FILES[key];
        if (file) this.sound.play(key, { volume: 0.9 });
    }

    // Pause/resume helpers (called via React through the pattern in the
    // pause screen — the scene always stays alive; only React toggles overlays).
    pauseWorld() {
        this.tweens.pauseAll();
        this.sound.pauseAll();
        this.time.paused = true;
    }

    resumeWorld() {
        this.tweens.resumeAll();
        this.sound.resumeAll();
        this.time.paused = false;
    }

    update(_time: number, _delta: number) {
        // Ambient handled by particles; no per-frame scene logic needed.
    }
}

// ---------------------------------------------------------------------------
// color helpers
// ---------------------------------------------------------------------------
function lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | bl;
}

// ---------------------------------------------------------------------------
// BOOTSTRAP
// ---------------------------------------------------------------------------
function StartGame(parent: string) {
    const config: Phaser.Types.Core.GameConfig = {
        type: AUTO,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        parent,
        backgroundColor: '#2b1d14',
        scale: {
            mode: Scale.FIT,
            autoCenter: Scale.CENTER_BOTH,
        },
        physics: {
            default: 'arcade',
            arcade: { gravity: { x: 0, y: 0 } },
        },
        audio: { disableWebAudio: false },
        scene: [Game],
    };

    return new PhaserGame(config);
}

export default StartGame;