import * as React from "react";
import styled from "styled-components";
import { CHORDS, Chord } from "./course/ChordClouds";

// Let's build stairs for minor mode
// It's essentially a set of chords
// The tricky part is to position them correctly in a bounding box.
// We can make calculations based on the highest note of a last chord
// and work back from it.

const NOTE_HEIGHT = 5;
const NOTE_WIDTH = 40;
const HORIZONTAL_GAP = 15;

const ChordNote = styled.div`
  user-select: none;
  border-radius: 5px;
  width: ${NOTE_WIDTH}px;
  height: ${NOTE_HEIGHT}px;
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
    title: "natural minor",
    chords: ["iv", "bVI", "i", "bIII", "v", "bVII"],
  },
  {
    title: "harmonic minor",
    chords: ["iv", "bVI", "i", "bIII", "V", "bVII"],
  },
  { title: "major key", chords: ["ii", "IV", "vi", "I", "iii", "V"] },
];

const base12 = (num) => Math.floor(num / 12) * 12;

const ChordStairs: React.FC<{ mode: Mode }> = ({ mode }) => {
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

  return (
    <div
      style={{
        width: numChords * NOTE_WIDTH + (numChords - 1) * HORIZONTAL_GAP,
        height: height * NOTE_HEIGHT,
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0 }}>{title}</div>
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
              index < 2
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
};
export default ChordStairs;
