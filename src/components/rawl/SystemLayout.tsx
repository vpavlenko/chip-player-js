import * as React from "react";
import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DUMMY_CALLBACK, VoiceMask } from "../App";
import { AnalysisGrid, Cursor, MeasureSelection } from "./AnalysisGrid";
import { SecondsConverter, SecondsSpan, SetVoiceMask } from "./Rawl";
import { Analysis, getPhraseStarts, MeasuresSpan } from "./analysis";
import { getNoteRectangles, MouseHandlers } from "./getNoteRectangles";
import ControlPanel, { debounce } from "./layouts/ControlPanel";
import MergedVoicesLegend from "./layouts/MergedVoicesLegend";
import { ColoredNote, ColoredNotesInVoices, Note } from "./parseMidi";
import { TonalHistogram } from "./tonalSearch/TonalSearch";

export type MeasuresAndBeats = {
  measures: number[];
  beats: number[];
  ticks?: { measures: number[] };
};

const getAverageMidiNumber = (notes: Note[]) =>
  notes.length > 0
    ? notes[0].isDrum
      ? 0
      : notes.reduce((sum, note) => sum + note.note.midiNumber, 0) /
        notes.length
    : Infinity;

// TODO: rename "stacked" to "split" - semantically
export type SystemLayout = "merged" | "stacked" | "tonal" | "frozen";

export type MidiRange = [number, number];

const getMidiRange = (notes: Note[], span?: SecondsSpan): MidiRange => {
  let min = +Infinity;
  let max = -Infinity;
  for (const note of notes) {
    if (span && (note.span[1] < span[0] || note.span[0] > span[1])) {
      continue;
    }
    const { midiNumber, relativeNumber } = note.note;
    const number = relativeNumber === undefined ? midiNumber : relativeNumber;
    min = Math.min(min, number);
    max = Math.max(max, number);
  }
  return [min, max];
};

type ScrollInfo = {
  left: number;
  right: number;
};

const VoiceName: React.FC<{
  voiceName: string;
  voiceMask: VoiceMask;
  setVoiceMask: SetVoiceMask;
  voiceIndex: number;
  scrollInfo: ScrollInfo;
  secondsToX: SecondsConverter;
  midiNumberToY: (number) => number;
}> = ({
  voiceName,
  voiceMask,
  setVoiceMask,
  voiceIndex,
  scrollInfo,
  secondsToX,
  midiNumberToY,
}) => {
  const isSingleActive =
    voiceMask[voiceIndex] && voiceMask.filter((voice) => voice).length === 1;

  const ref = useRef(null);
  const [top, setTop] = useState(0);

  const updatePosition = () => {
    if (ref.current) {
      const outerComponentRect =
        ref.current.parentElement.getBoundingClientRect();
      setTop(outerComponentRect.top + window.scrollY - 5);
    }
  };

  useEffect(updatePosition, [scrollInfo, secondsToX, midiNumberToY]);

  useEffect(() => {
    ref.current
      .closest(".SplitLayout")
      ?.addEventListener("scroll", updatePosition);

    ref.current.closest(".Rawl")?.addEventListener("scroll", updatePosition);

    return () => {
      ref.current
        .closest(".SplitLayout")
        ?.removeEventListener("scroll", updatePosition);
      ref.current
        .closest(".Rawl")
        ?.removeEventListener("scroll", updatePosition);
    };
  }, []);

  return (
    <span
      style={{
        position: "fixed",
        top,
        left: 2,
        marginLeft: 2,
        marginTop: 7,
        fontFamily: "sans-serif",
        fontSize: 12,
        textShadow: "0 0 1px black, 0 0 3px black, 0 0 6px black",
        userSelect: "none",
        zIndex: 100,
      }}
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <span>
        <button
          style={{
            cursor: "pointer",
            userSelect: "none",
            fontFamily: "sans-serif",
            fontSize: 12,
          }}
          onClick={(e) => {
            e.stopPropagation();
            isSingleActive
              ? setVoiceMask(voiceMask.map(() => true))
              : setVoiceMask(voiceMask.map((_, i) => i === voiceIndex));
          }}
        >
          {isSingleActive ? "Unsolo All" : "Solo"}
        </button>

        <input
          title="active"
          type="checkbox"
          onChange={(e) => {
            e.stopPropagation();
            setVoiceMask(
              voiceMask.map((value, i) => (i === voiceIndex ? !value : value)),
            );
          }}
          checked={voiceMask[voiceIndex]}
          style={{
            margin: "0px 0px 0px 17px",
            height: 11,
            display: isSingleActive ? "none" : "inline",
          }}
        />
      </span>
      <span
        style={{
          color: voiceMask[voiceIndex] ? "white" : "#444",
          marginLeft: "10px",
          zIndex: 100,
        }}
      >
        {voiceName}
      </span>
    </span>
  );
};

const MeasureNumbers = ({
  measuresAndBeats,
  analysis,
  phraseStarts,
  measureSelection,
  noteHeight,
  secondsToX,
  sectionSpan,
}: {
  measuresAndBeats: MeasuresAndBeats;
  analysis: Analysis;
  phraseStarts: number[];
  measureSelection: MeasureSelection;
  noteHeight: number;
  secondsToX: SecondsConverter;
  sectionSpan?: MeasuresSpan;
}) => (
  <div
    key="measure_header"
    style={{
      width:
        secondsToX(
          Math.max(
            measuresAndBeats.measures.at(-1),
            measuresAndBeats.beats.at(-1),
          ),
        ) + 300,
      height: 16,
      marginBottom: "-14px",
      marginLeft: "0px",
      zIndex: 90000,
      position: sectionSpan ? "relative" : "sticky",
      top: 0,
    }}
  >
    <AnalysisGrid
      analysis={analysis}
      measuresAndBeats={measuresAndBeats}
      midiNumberToY={() => 0}
      noteHeight={noteHeight}
      measureSelection={measureSelection}
      phraseStarts={phraseStarts}
      midiRange={[0, 0]}
      showHeader={true}
      showTonalGrid={false}
      secondsToX={secondsToX}
      sectionSpan={sectionSpan}
    />
  </div>
);

export const Voice: React.FC<{
  notes: ColoredNote[];
  measuresAndBeats: MeasuresAndBeats;
  analysis: Analysis;
  cursor: ReactNode;
  phraseStarts: number[];
  mouseHandlers: MouseHandlers;
  measureSelection: MeasureSelection;
  scrollInfo: ScrollInfo;
  voiceName: string;
  setVoiceMask: SetVoiceMask;
  voiceIndex: number;
  voiceMask: VoiceMask;
  showTonalGrid?: boolean;
  noteHeight: number;
  secondsToX: SecondsConverter;
  xToSeconds: SecondsConverter;
  sectionSpan?: MeasuresSpan;
  enableManualRemeasuring: boolean;
}> = ({
  notes,
  measuresAndBeats,
  analysis,
  mouseHandlers,
  measureSelection,
  cursor,
  phraseStarts,
  scrollInfo,
  voiceName,
  voiceIndex = -1,
  setVoiceMask = (mask) => {},
  voiceMask,
  showTonalGrid = true,
  noteHeight,
  secondsToX,
  xToSeconds,
  sectionSpan,
  enableManualRemeasuring,
}) => {
  // To restore it, we need to lock the calculation of frozenRange and frozenHeight
  // and don't change it after loading the notes.

  const localMidiRange = useMemo(
    () =>
      getMidiRange(notes, [
        xToSeconds(scrollInfo.left),
        xToSeconds(scrollInfo.right),
      ]),
    [notes, scrollInfo, xToSeconds],
  );
  const midiRange = useMemo(() => getMidiRange(notes), [notes]);

  const { systemClickHandler, handleNoteClick, handleMouseEnter } =
    mouseHandlers;

  const height =
    (midiRange[0] === +Infinity ? 0 : midiRange[1] - midiRange[0] + 1) *
    noteHeight;

  const midiNumberToY = useCallback(
    (midiNumber) => height - (midiNumber - midiRange[0] + 1) * noteHeight,
    [height, midiRange, noteHeight],
  );

  // The frozenHeight machinery was used when I experimented with smart
  // collapse/expand of every Voice relative to its current range on a current screen.
  // I'm not sure it's used anymore.
  const { noteRectangles, frozenHeight, frozenMidiRange } = useMemo(
    () => ({
      noteRectangles: getNoteRectangles(
        notes,
        midiNumberToY,
        noteHeight,
        handleNoteClick,
        handleMouseEnter,
        DUMMY_CALLBACK,
        secondsToX,
        enableManualRemeasuring,
      ),
      frozenHeight: height,
      frozenMidiRange: midiRange,
    }),
    [
      notes,
      analysis,
      handleNoteClick,
      handleMouseEnter,
      voiceMask,
      noteHeight,
      secondsToX,
      enableManualRemeasuring,
    ],
  );

  const { measures } = measuresAndBeats;
  // TODO: make smarter once Stacked is implemented
  const hasVisibleNotes =
    voiceMask[voiceIndex] &&
    (!!sectionSpan || localMidiRange[1] >= localMidiRange[0]);

  return (
    <div
      key={`voice_${voiceIndex}_${measuresAndBeats.measures.at(-1)}_parent`}
      style={{
        width: secondsToX(measures[sectionSpan?.[1] ?? measures.length - 1]),
        height: hasVisibleNotes ? height : 1,
        position: "relative",
        marginTop: hasVisibleNotes ? "15px" : 0,
        marginBottom: hasVisibleNotes ? "0px" : 0,
        marginLeft: "0px",
        // borderBottom: hasVisibleNotes ? "1px solid #888" : "",
        zIndex: 1,
        backgroundColor: "black",
      }}
      onClick={(e) => systemClickHandler(e, xToSeconds)}
    >
      <div
        style={{
          position: "relative",
          top:
            height -
            frozenHeight +
            (midiRange[0] - frozenMidiRange[0]) * noteHeight,
        }}
      >
        {voiceMask[voiceIndex] ? noteRectangles : null}
      </div>
      {hasVisibleNotes ? (
        <AnalysisGrid
          analysis={analysis}
          measuresAndBeats={measuresAndBeats}
          midiNumberToY={midiNumberToY}
          noteHeight={noteHeight}
          measureSelection={measureSelection}
          phraseStarts={phraseStarts}
          midiRange={midiRange}
          showHeader={false}
          showTonalGrid={showTonalGrid && !notes[0]?.isDrum}
          secondsToX={secondsToX}
          sectionSpan={sectionSpan}
        />
      ) : null}
      {cursor}
      {hasVisibleNotes &&
      voiceMask.length > 1 &&
      (sectionSpan?.[0] ?? 0) === 0 &&
      voiceName ? (
        <VoiceName
          voiceName={voiceName}
          voiceMask={voiceMask}
          setVoiceMask={setVoiceMask}
          voiceIndex={voiceIndex}
          scrollInfo={scrollInfo}
          secondsToX={secondsToX}
          midiNumberToY={midiNumberToY}
        />
      ) : null}
    </div>
  );
};

type Section = {
  sectionSpan: MeasuresSpan;
  secondsToX: SecondsConverter;
  xToSeconds: SecondsConverter;
  voices: { voiceIndex: number; notes: ColoredNote[] }[];
};

export type SystemLayoutProps = {
  notes: ColoredNotesInVoices;
  voiceNames: string[];
  voiceMask: VoiceMask;
  measuresAndBeats: MeasuresAndBeats;
  positionSeconds: number;
  analysis: Analysis;
  mouseHandlers: MouseHandlers;
  measureSelection: MeasureSelection;
  setVoiceMask: SetVoiceMask;
  registerKeyboardHandler: (
    name: string,
    handler: (e: KeyboardEvent) => void,
  ) => void;
  unregisterKeyboardHandler: (name: string) => void;
  tonalHistograms: TonalHistogram[];
  frozenNotes: ColoredNote[][];
  enableManualRemeasuring?: boolean;
  measureStart?: number;
};

export const TonalHistogramLayout: React.FC<SystemLayoutProps> = ({
  measuresAndBeats,
  analysis,
  measureSelection,
  tonalHistograms,
}) => {
  const [noteHeight, setNoteHeight] = useState<number>(4);
  const [secondWidth, setSecondWidth] = useState<number>(45);

  const phraseStarts = useMemo(
    () => getPhraseStarts(analysis, measuresAndBeats.measures.length),
    [analysis, measuresAndBeats],
  );

  const secondsToX = useCallback(
    (seconds: number) => seconds * secondWidth,
    [secondWidth],
  );

  return (
    <div style={{ padding: "20px", backgroundColor: "black" }}>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {tonalHistograms.map((histogram, index) => (
          <div key={index} style={{ margin: "10px", textAlign: "center" }}>
            <div
              style={{ fontSize: "12px", color: "white", marginBottom: "5px" }}
            >
              Measure {index + 1}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                height: "100px",
                width: "60px",
              }}
            >
              {histogram.map((bar, barIndex) => (
                <div
                  key={barIndex}
                  className={`noteColor_${
                    barIndex === 6 ? 0 : barIndex
                  }_colors`}
                  style={{
                    width: "5px",
                    height: `${bar * 100}%`,
                    marginRight: "1px",
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const StackedSystemLayout: React.FC<
  SystemLayoutProps & { measureStart?: number }
> = ({
  notes,
  voiceNames,
  voiceMask,
  measuresAndBeats,
  positionSeconds,
  analysis,
  mouseHandlers,
  measureSelection,
  setVoiceMask,
  registerKeyboardHandler,
  unregisterKeyboardHandler,
  enableManualRemeasuring = false,
  measureStart,
}) => {
  const [noteHeight, setNoteHeight] = useState<number>(3.5);
  const [secondWidth, setSecondWidth] = useState<number>(40);
  const setSecondWidthCalled = useRef(false);

  useEffect(() => {
    setSecondWidthCalled.current = false;
  }, [secondWidth]);

  const prevPositionSeconds = useRef<number>(0);
  useEffect(() => {
    prevPositionSeconds.current = positionSeconds;
  }, [positionSeconds]);

  const voicesSortedByAverageMidiNumber = useMemo(
    () =>
      notes
        .map((voice, voiceIndex) => ({
          average: getAverageMidiNumber(voice),
          voiceIndex,
        }))
        .sort((a, b) => b.average - a.average)
        .map(({ voiceIndex }) => ({
          voiceIndex,
          notes: notes[voiceIndex],
        })),
    [notes],
  );

  // TODO: make sure the very last measure is also a phrase start
  const phraseStarts = useMemo(
    () => getPhraseStarts(analysis, measuresAndBeats.measures.length),
    [analysis, measuresAndBeats],
  );

  const sections: Section[] = useMemo(
    () =>
      (analysis.sections ?? [0]).map((sectionStartInPhrases, index) => {
        const { measures } = measuresAndBeats;
        const start = phraseStarts[sectionStartInPhrases] - 1;
        const end =
          (index + 1 < (analysis.sections ?? [0]).length
            ? phraseStarts[(analysis.sections ?? [0])[index + 1]]
            : measures.length) - 1;

        const secondsToX = (seconds) =>
          (seconds - measures[start]) * secondWidth;
        const xToSeconds = (x) => x / secondWidth + measures[start];
        return {
          sectionSpan: [start, end],
          secondsToX,
          xToSeconds,
          voices: voicesSortedByAverageMidiNumber.map(
            ({ voiceIndex, notes }) => ({
              voiceIndex,
              notes: notes.filter(
                (note) =>
                  note.span[1] >= measures[start] &&
                  note.span[0] + 1e-2 < measures[end],
              ),
            }),
          ),
        };
      }),
    [
      voicesSortedByAverageMidiNumber,
      phraseStarts,
      measuresAndBeats,
      secondWidth,
      analysis.sections,
    ],
  );

  const parentRef = useRef(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [scrollInfo, setScrollInfo] = useState<ScrollInfo>({
    left: -1,
    right: 100000,
  });

  const debouncedScroll = useCallback(
    debounce(
      (left, right) =>
        setScrollInfo({
          left,
          right,
        }),
      50,
    ),
    [],
  );

  const handleScroll = () => {
    const { scrollLeft, offsetWidth } = parentRef.current;
    const scrollRight = scrollLeft + offsetWidth;

    debouncedScroll(scrollLeft, scrollRight);
  };

  useEffect(() => {
    const parentDiv = parentRef.current;
    if (parentDiv) {
      parentDiv.addEventListener("scroll", handleScroll);
      handleScroll();
    }

    return () => {
      if (parentDiv) {
        parentDiv.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  useEffect(() => {
    if (
      measureStart !== undefined &&
      parentRef.current &&
      sectionRefs.current.length > 0
    ) {
      const sectionIndex = sections.findIndex(
        ({ sectionSpan }) =>
          measureStart >= sectionSpan[0] && measureStart <= sectionSpan[1],
      );

      if (sectionIndex !== -1) {
        const sectionElement = sectionRefs.current[sectionIndex];
        if (sectionElement) {
          sectionElement.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    }
  }, [measureStart, sections]);

  return (
    <>
      <div
        key="innerLeftPanel"
        style={{
          margin: 0,
          padding: 0,
          position: "relative",
          overflowX: "scroll",
          overflowY: "scroll",
          width: "100%",
          height: "100%",
          backgroundColor: "black",
        }}
        ref={parentRef}
        className="SplitLayout"
      >
        {sections.map(
          ({ sectionSpan, secondsToX, xToSeconds, voices }, order) => (
            <div
              style={{ paddingTop: 10 + noteHeight * 5 }}
              key={order}
              ref={(el) => (sectionRefs.current[order] = el)}
            >
              <MeasureNumbers
                measuresAndBeats={measuresAndBeats}
                analysis={analysis}
                phraseStarts={phraseStarts}
                measureSelection={measureSelection}
                noteHeight={noteHeight}
                secondsToX={secondsToX}
                sectionSpan={sectionSpan}
              />
              {voices.map(({ notes, voiceIndex }) => (
                <div
                  key={voiceIndex}
                  style={{ display: "flex", flexDirection: "row" }}
                >
                  <Voice
                    voiceName={voiceNames[voiceIndex]}
                    notes={notes}
                    measuresAndBeats={measuresAndBeats}
                    analysis={analysis}
                    mouseHandlers={mouseHandlers}
                    measureSelection={measureSelection}
                    cursor={
                      positionSeconds <
                        measuresAndBeats.measures[sectionSpan[1]] && (
                        <Cursor
                          key={"cursor"}
                          style={{
                            transition:
                              !setSecondWidthCalled.current &&
                              Math.abs(
                                prevPositionSeconds.current - positionSeconds,
                              ) < 2
                                ? "left 0.74s linear"
                                : "",
                            left: secondsToX(positionSeconds),
                          }}
                        />
                      )
                    }
                    phraseStarts={phraseStarts}
                    scrollInfo={scrollInfo}
                    voiceMask={voiceMask}
                    setVoiceMask={setVoiceMask}
                    voiceIndex={voiceIndex}
                    noteHeight={noteHeight}
                    secondsToX={secondsToX}
                    xToSeconds={xToSeconds}
                    sectionSpan={sectionSpan}
                    enableManualRemeasuring={enableManualRemeasuring}
                  />
                </div>
              ))}
            </div>
          ),
        )}

        <div style={{ height: 600 }} />

        <ControlPanel
          noteHeight={noteHeight}
          setNoteHeight={setNoteHeight}
          secondWidth={secondWidth}
          setSecondWidth={setSecondWidth}
          registerKeyboardHandler={registerKeyboardHandler}
          unregisterKeyboardHandler={unregisterKeyboardHandler}
        />
      </div>
    </>
  );
};

const MERGED_VOICE_NAMES = ["merged"];
const MERGED_VOICE_MASK = [true];

export const MergedSystemLayout: React.FC<SystemLayoutProps> = (props) => {
  const {
    notes,
    voiceNames,
    voiceMask,
    setVoiceMask,
    enableManualRemeasuring,
  } = props;

  const flattenedNotes = useMemo(
    () => [
      notes
        .filter((notes) => (notes && notes[0].isActive) || !notes[0].isDrum)
        .flat(),
    ],
    [notes],
  );

  return (
    <div style={{ position: "relative" }}>
      <StackedSystemLayout
        {...props}
        notes={flattenedNotes}
        voiceNames={MERGED_VOICE_NAMES}
        voiceMask={MERGED_VOICE_MASK}
        enableManualRemeasuring={enableManualRemeasuring}
      />
      <MergedVoicesLegend
        voiceNames={voiceNames}
        voiceMask={voiceMask}
        setVoiceMask={setVoiceMask}
      />
    </div>
  );
};
