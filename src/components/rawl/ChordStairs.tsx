import * as React from "react";
import styled from "styled-components";
import { CHORDS, Chord } from "./course/ChordClouds";

const NOTE_HEIGHT = 4;
const NOTE_WIDTH = 40;
const HORIZONTAL_GAP = 25;

const ChordNote = styled.div`
  user-select: none;
  border-radius: 3px;
  width: ${NOTE_WIDTH}px;
  height: ${NOTE_HEIGHT * 2}px;
`;

const ChordName = styled.div`
  width: ${NOTE_WIDTH}px;
  height: 20px;
  display: flex;
  justify-content: center;
  text-align: center;
`;

type Mode = { title: string; chords: Chord[] };

export const MODES: Mode[] = [
  {
    title: "minor",
    chords: ["iio", "iv", "bVI", "i", "bIII", "v", "V", "V7", "bVII"],
  },
  { title: "major", chords: ["ii", "IV", "vi", "I", "iii", "V", "V7"] },
  {
    title: "chromatic",
    chords: ["V7/ii", "V7/iii", "V7/IV", "bII", "V7/V", "V7/vi", "viio7/V"],
  },
];

const ChordStairs: React.FC<{ mode: Mode }> = React.memo(({ mode }) => {
  const { title, chords } = mode;
  const numChords = chords.length;

  const rehydratedChords: { name: Chord; pitches: number[] }[] = chords.map(
    (chord) => ({
      name: chord,
      pitches: [...CHORDS[chord]],
    }),
  );
  for (let i = 0; i < rehydratedChords.length; ++i) {
    const { name, pitches } = rehydratedChords[i];
    if (i > 0 && pitches[0] < rehydratedChords[i - 1].pitches[0]) {
      pitches[0] += 12;
    }
    for (let j = 1; j < pitches.length; ++j) {
      pitches[j] =
        pitches[j - 1] + ((CHORDS[name][j] - CHORDS[name][j - 1] + 12) % 12);
    }
  }

  const maxPitch = rehydratedChords.at(-1).pitches.at(-1);

  const height = maxPitch - rehydratedChords[0].pitches[0] + 1;

  const tonicChordPosition = chords.findIndex((chord) => /^(i|I)$/.test(chord));

  return (
    <div
      key={title}
      style={{
        width: numChords * NOTE_WIDTH + (numChords - 1) * HORIZONTAL_GAP,
        height: height * NOTE_HEIGHT,
        position: "relative",
        zIndex: -5,
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, color: "#aaa" }}>
        {title}
      </div>
      {rehydratedChords.flatMap(({ pitches }, index) =>
        pitches.map((pitch) => (
          <ChordNote
            className={`noteColor_${pitch % 12}_colors`}
            style={{
              position: "absolute",
              left: index * (NOTE_WIDTH + HORIZONTAL_GAP),
              top: (maxPitch - pitch) * NOTE_HEIGHT,
            }}
          />
        )),
      )}
      {rehydratedChords.map(({ name, pitches }, index) => (
        <ChordName
          style={{
            position: "absolute",
            top:
              index < tonicChordPosition
                ? (maxPitch - pitches.at(-1)) * NOTE_HEIGHT - 25
                : (maxPitch - pitches[0]) * NOTE_HEIGHT + 10,
            left: index * (NOTE_WIDTH + HORIZONTAL_GAP),
          }}
        >
          {name.replace("b", "♭")}
        </ChordName>
      ))}
    </div>
  );
});

export default ChordStairs;
