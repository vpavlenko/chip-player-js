import * as React from "react";
import styled, { CSSProperties } from "styled-components";
import { Note, secondsToX } from "./Chiptheory";
import { MeasuresAndBeats } from "./helpers";

export const RESOLUTION_DUMPS_PER_SECOND = 100;
export const RESOLUTION_MS = 1 / RESOLUTION_DUMPS_PER_SECOND;

export const STEPS = [
  "first measure",
  "second measure",
  "tonic",
  "mode",
  "end",
] as const;

export type Step = (typeof STEPS)[number];

const STEP_FONT_COLOR: {
  [key in Step]: string;
} = {
  "first measure": "#ffaaaa",
  "second measure": "#ffffaa",
  tonic: "#aaffaa",
  mode: "#aaffff",
  end: "white",
};

export const STEP_CALL_TO_ACTION: Record<Step, string> = {
  "first measure":
    "Beat tracking 1. Click on a note at the start of the first measure of the main section. You may skip the intro",
  "second measure":
    "Beat tracking 2. Click on a note at the start of the second measure of the main section",
  tonic: "Click on a tonic of the main section",
  mode: "Click on a minor/major third on top of the tonic. It doesn't matter on 12-tone coloring, but matters in 7-tone coloring",
  // mode: "Step 4. Click on a characteristic note of the main section. Minor: b3, major: 3, phrygian: b2, dorian: #6, mixolydian: b7, blues: #4, pentatonic: 4",
  end: "Click on root notes to enter chords",
};

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type ScaleDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;
type PitchClassToScaleDegree = [
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
  ScaleDegree,
]; // 12

// const MODES = [null, 'phrygian', null, 'minor', 'major', 'minor pentatonic', 'blues', null, null, 'dorian', 'mixolydian', null] as const
const MODES = [
  null,
  "phrygian",
  null,
  "minor",
  "major",
  null,
  null,
  null,
  null,
  "dorian",
  "mixolydian",
  null,
] as const;
export type Mode = (typeof MODES)[number];

const RAINBOW_COLORS = [
  "red",
  "#cc7700",
  "#C1C100",
  "green",
  "blue",
  "#9400D3",
  "#FF1493",
];

const TWELVE_TONE_COLORS = [
  "red",
  "brown", // CC5500
  "#FF8C00",
  "#C1C100",
  "green",
  "#0EFFD0",
  "#787276",
  "blue",
  "#CF9FFF",
  "#9400D3",
  "#FF1493",
  "#ffb3b3",
];

// if we have a note, it's color is mapped into degree, then mapped into colors

export type PitchClassToScaleDegreeViaMode = {
  [K in Mode]: K extends string ? PitchClassToScaleDegree : never;
};

const MIDI_NOTE_TO_SCALE_DEGREE: PitchClassToScaleDegreeViaMode = {
  phrygian: [1, 2, null, 3, null, 4, null, 5, 6, null, 7, null],
  minor: [1, null, 2, 3, null, 4, null, 5, 6, null, 7, null],
  dorian: [1, null, 2, 3, null, 4, null, 5, null, 6, 7, null],
  mixolydian: [1, null, 2, null, 3, 4, null, 5, null, 6, 7, null],
  major: [1, null, 2, null, 3, 4, null, 5, null, 6, null, 7],
};

export type Analysis = {
  clickResolutionMs: number;
  step: Step;
  firstMeasure: number;
  secondMeasure: number;
  correctedMeasures: { [key: number]: number };
  fourMeasurePhrasingReferences: number[];
  loop: number | null;
  tonic: PitchClass | null;
  mode: Mode;
};

export const getTransparencyGradient = (color) => ({
  // background: `linear-gradient(to right, ${color} 0px, ${color} 10px, ${color} 50%, transparent 100%)`, // 1000px disables gradient
  backgroundColor: color,
});

export const getNoteColor = (
  defaultColor: string,
  midiNumber,
  analysis,
): CSSProperties => {
  if (defaultColor === "under cursor") {
    return {
      // boxShadow: "gray 0px 1px, white 0px 1.5px",
      boxShadow: "white 0px 1px",
      boxSizing: "border-box",
      backgroundColor: "transparent",
    };
  }
  if (
    defaultColor === "black" ||
    analysis.tonic === null ||
    analysis.mode === null
  ) {
    return getTransparencyGradient(defaultColor);
  }

  // const mapping = MIDI_NOTE_TO_SCALE_DEGREE[analysis.mode];
  // let pointer = (midiNumber - analysis.tonic) % 12;
  // if (mapping[pointer] === null) {
  //   return getTransparencyGradient("#bbb");
  // }

  // return getTransparencyGradient(RAINBOW_COLORS[mapping[pointer] - 1]);
  return getTransparencyGradient(
    TWELVE_TONE_COLORS[(midiNumber - analysis.tonic) % 12],
  );
};

export const ANALYSIS_STUB: Analysis = {
  clickResolutionMs: RESOLUTION_MS,
  step: STEPS[0],
  firstMeasure: null,
  secondMeasure: null,
  correctedMeasures: [],
  fourMeasurePhrasingReferences: [],
  loop: null,
  tonic: null,
  mode: null,
};

// These two don't propagate to Firestore because they tweak transient state.
export const prevStep = (analysis, setAnalysis) =>
  setAnalysis({ ...analysis, step: STEPS[STEPS.indexOf(analysis.step) - 1] });

export const nextStep = (analysis, setAnalysis) =>
  setAnalysis({ ...analysis, step: STEPS[STEPS.indexOf(analysis.step) + 1] });

export const advanceAnalysis = (
  note: Note,
  selectedDownbeat: number | null,
  selectDownbeat: (_: null) => void,
  analysis: Analysis,
  saveAnalysis,
  setAnalysis,
) => {
  let update: Partial<Analysis> = {};

  if (selectedDownbeat !== null) {
    update.correctedMeasures = { ...(analysis.correctedMeasures || []) };
    update.correctedMeasures[selectedDownbeat] = note.span[0];
    selectDownbeat(null);
  } else {
    const { step } = analysis;
    if (step === "end") {
      // enter chords
      // get note degree
      // get measure notes
      // compare thirds
      // if previous chords: span the last one?
    } else {
      update.step = STEPS[STEPS.indexOf(step) + 1];
    }

    if (step === "first measure") {
      update.firstMeasure = note.span[0];
    } else if (step === "second measure") {
      update.secondMeasure = note.span[0];
    } else if (step === "tonic") {
      update.tonic = (note.note.midiNumber % 12) as PitchClass;
    } else if (step === "mode") {
      update.mode = MODES[(note.note.midiNumber - analysis.tonic) % 12];
    }
  }

  const newAnalysis = { ...analysis, ...update };

  saveAnalysis(newAnalysis);
  setAnalysis(newAnalysis);
};

const VerticalBar = styled.div`
  width: 1px;
  height: 100%;
  position: absolute;
  top: 0;
  z-index: 2;
`;

export const Cursor = styled(VerticalBar)`
  background-color: #ff6666;
`;

const Downbeat = styled(VerticalBar)`
  background-color: #444;
`;

const BeatBar = styled(VerticalBar)`
  border-left: 1px dashed #222;
`;

const Measure: React.FC<{
  second: number;
  number: number;
  isFourMeasureMark: boolean;
  selectedDownbeat: number;
  selectDownbeat: (number: number) => void;
}> = ({
  second,
  number,
  isFourMeasureMark,
  selectedDownbeat,
  selectDownbeat,
}) => {
  const left = secondsToX(second);
  return (
    <>
      <Downbeat
        style={{
          left,
          ...(isFourMeasureMark && { backgroundColor: "#aaa" }),
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 10,
          left: `${left + 5}px`,
          color: selectedDownbeat === number ? "red" : "white",
          zIndex: 5,
          cursor: "pointer",
        }}
        onClick={() => selectDownbeat(number)}
      >
        {number}
      </div>
    </>
  );
};

const Beat = ({ second }) => (
  <BeatBar style={{ left: secondsToX(second), zIndex: 2 }} />
);

const TonalGrid = ({ tonic, width, midiNumberToY, noteHeight }) => {
  if (tonic === null) {
    return [];
  }
  const result = [];
  for (let octave = 2; octave <= 7; ++octave) {
    const midiNumber = tonic + octave * 12;
    result.push(
      <div
        key={midiNumber}
        style={{
          position: "absolute",
          width: `${width}px`,
          height: noteHeight,
          left: 0,
          top: midiNumberToY(midiNumber),
          backgroundColor: "#222",
          zIndex: 1,
        }}
      />,
    );
  }
  return result;
};

export const AnalysisGrid: React.FC<{
  analysis: Analysis;
  allNotes: Note[];
  measuresAndBeats: MeasuresAndBeats;
  midiNumberToY: (number: number) => number;
  noteHeight: number;
  selectedDownbeat: number;
  selectDownbeat: (number: number) => void;
}> = React.memo(
  ({
    analysis,
    allNotes,
    measuresAndBeats,
    midiNumberToY,
    noteHeight,
    selectedDownbeat,
    selectDownbeat,
  }) => {
    const { measures, beats } = measuresAndBeats;
    const maxRigthSpan = allNotes.reduce(
      (maxValue, note) => Math.max(maxValue, note.span[1]),
      -Infinity,
    );
    let loopLeft = null;

    if (analysis.loop) {
      loopLeft = secondsToX(measures[analysis.loop - 1]);
    }
    return (
      <>
        {measures.map((time, i) => {
          const fourMeasurePhrasingStart =
            analysis.fourMeasurePhrasingReferences?.[0] ?? 1;
          const number = i + 1;
          return (
            <Measure
              key={i}
              second={time}
              isFourMeasureMark={
                number >= fourMeasurePhrasingStart &&
                number % 4 == fourMeasurePhrasingStart % 4
              }
              number={i + 1}
              selectedDownbeat={selectedDownbeat}
              selectDownbeat={selectDownbeat}
            />
          );
        })}
        {beats.map((time) => (
          <Beat key={time} second={time} />
        ))}
        {
          <TonalGrid
            tonic={analysis.tonic}
            width={secondsToX(maxRigthSpan) + 100}
            midiNumberToY={midiNumberToY}
            noteHeight={noteHeight}
          />
        }
        {loopLeft && (
          <div
            style={{
              position: "absolute",
              backgroundColor: "#222",
              left: loopLeft,
              height: "100%",
              right: 0,
              opacity: 0.7,
              zIndex: 100,
              width: "3000px",
            }}
          >
            <div style={{ margin: "20px", color: "white" }}>Loop</div>
          </div>
        )}
      </>
    );
  },
);

type AnalysisPart = React.FC<{ analysis: Analysis }>;

const Key: AnalysisPart = React.memo(({ analysis }) => {
  const { tonic, mode } = analysis;
  return <>{tonic !== null && <div>midiNumber: {tonic}</div>}</>;
});

export const AnalysisBox: React.FC<{
  analysis: Analysis;
  saveAnalysis: (analysis: Analysis) => void;
  setAnalysis: (analysis: Analysis) => void;
  selectedDownbeat: number;
  selectDownbeat: (downbeat: number | null) => void;
}> = React.memo(
  ({
    analysis,
    saveAnalysis,
    setAnalysis,
    selectedDownbeat,
    selectDownbeat,
  }) => {
    return (
      <>
        <div className="App-main-content-area settings">
          <div>
            <div style={{ display: "flex", flexDirection: "row" }}>
              <div style={{ marginBottom: "10px" }}>
                <button
                  className="box-button"
                  disabled={analysis.step === STEPS[0]}
                  onClick={() => prevStep(analysis, setAnalysis)}
                >
                  &lt;
                </button>{" "}
                <button
                  className="box-button"
                  disabled={analysis.step === STEPS[STEPS.length - 1]}
                  onClick={() => nextStep(analysis, setAnalysis)}
                >
                  &gt;
                </button>
              </div>
            </div>
            {"  "}
            {selectedDownbeat === null && (
              <div style={{ color: STEP_FONT_COLOR[analysis.step] }}>
                {STEP_CALL_TO_ACTION[analysis.step]}
              </div>
            )}
          </div>
          <div style={{ marginTop: "20px" }}>
            {selectedDownbeat !== null && (
              <div>
                <div>What to do with measure {selectedDownbeat}?</div>
                <ul className="vertical-list-of-buttons">
                  <li>
                    <button
                      className="box-button"
                      onClick={() => {
                        const newAnalysis = {
                          ...analysis,
                          loop: selectedDownbeat,
                        };

                        selectDownbeat(null);
                        saveAnalysis(newAnalysis);
                        setAnalysis(newAnalysis);
                      }}
                    >
                      Mark loop start
                    </button>
                  </li>
                  <li>
                    <button
                      className="box-button"
                      onClick={() => {
                        const newAnalysis = {
                          ...analysis,
                          fourMeasurePhrasingReferences: [selectedDownbeat],
                        };

                        selectDownbeat(null);
                        saveAnalysis(newAnalysis);
                        setAnalysis(newAnalysis);
                      }}
                    >
                      Mark start of 4-measure phrasing
                    </button>
                  </li>
                  <li>
                    <button
                      className="box-button"
                      onClick={() => {
                        selectDownbeat(null);
                      }}
                    >
                      Deselect
                    </button>
                  </li>
                  <li>Adjust downbeat: select note</li>
                </ul>
              </div>
            )}

            {/* <h2>Time</h2>
            <h2>Form</h2>
            <div>At which bar does it loop forever?</div> */}
            {/* <h2>Key</h2>
            <Key analysis={analysis}></Key> */}
            {/* <h2>Chords</h2>
            <h2>Harmony</h2>
            <h2>Arrangement</h2> */}
          </div>
        </div>
      </>
    );
  },
);
