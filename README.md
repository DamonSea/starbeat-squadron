# Starbeat Squadron

A Galaga-style rhythm shooter that runs in your browser. **Your cannon only fires on the beat.** The swarm sways, dives and shoots in time with the music, and every wave you clear pushes the tempo up.

**▶ Play it: https://damonsea.github.io/starbeat-squadron/**

## Features

- **8 tracks.** Four are generated live by the game: Neon Drive (synthwave), Mothership Strut (funk), Pixel Overture (chiptune) and Liquid Velocity (drum & bass). The other four are recordings: Moon Colony, Red Sky, Primate Pulse and Swarm Song. On those, the tempo stays fixed, and you win by surviving to the end of the song.
- **Timing grades.** A Perfect shot (within 55 ms of the beat) fires twin piercing shots, a Great shot (within 110 ms) fires one, and a Miss jams the cannon and resets your combo. Every 8 on-beat shots raises your score multiplier, up to ×8.
- **Boss stage every third stage.** The Skull Ship, Skull King, Demon Skull and Ghost Skull take turns. When a tractor beam catches you, land 4 Perfect shots in a row to break free.
- **Cassette-tape track select**, with a tape-deck start animation and a cassette pause screen.
- **Screen filters:** CRT, Game Boy, Monochrome and VHS.
- **PS5 and standard controller support**, with rumble.
- **A separate high score for each track**, saved in your browser.

## Controls

| | Keyboard | Controller |
|---|---|---|
| Fly | ← → or A / D | Left stick or d-pad |
| Fire (on the beat) | Space or J | ✕, □, R1 or R2 |
| Pause | P or Esc | Options (○ to resume) |
| Change track (menu) | ← → | Stick or d-pad |
| Cycle screen filter | F | |

If your shots keep grading late (common with Bluetooth headphones), raise the timing offset in the settings panel.

## Running it locally

The four built-in tracks work if you just open `index.html`. The recorded tracks load from mp3 files, and browsers block that for pages opened straight from your disk, so serve the folder instead:

```
python3 -m http.server
```

Then open http://localhost:8000.

## Files

- `index.html`: the whole game in one file (no build step, no dependencies)
- `*.mp3`: the four recorded tracks
- `original-version/`: the first prototype, with one synthwave track
