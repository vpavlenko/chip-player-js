import {
  MidiData,
  MidiEvent,
  MidiNoteOffEvent,
  MidiNoteOnEvent,
  MidiPitchBendEvent,
  parseMidi,
  writeMidi,
} from "midi-file";

type EnhancedMidiEvent = MidiEvent & {
  absoluteTime: number;
  originalTrack: number;
};

function isNoteOrPitchBendEvent(
  event: MidiEvent,
): event is MidiNoteOnEvent | MidiNoteOffEvent | MidiPitchBendEvent {
  return (
    event.type === "noteOn" ||
    event.type === "noteOff" ||
    event.type === "pitchBend"
  );
}

function isGlobalMetaEvent(event: MidiEvent): boolean {
  return (
    "subtype" in event &&
    typeof event.subtype === "string" &&
    ["setTempo", "timeSignature", "keySignature"].includes(event.subtype)
  );
}

function getTrackName(track: MidiEvent[]): string | undefined {
  const nameEvent = track.find(
    (event) => event.type === "trackName" && "text" in event,
  );
  if (nameEvent && "text" in nameEvent) {
    return nameEvent.text;
  }
  return undefined;
}

function createTrackNameEvent(name: string, deltaTime: number = 0): MidiEvent {
  return {
    deltaTime,
    type: "trackName",
    text: name,
  };
}

function createEndOfTrackEvent(deltaTime: number = 0): MidiEvent {
  return {
    deltaTime,
    type: "endOfTrack",
  };
}

function ensureTrackEnding(track: MidiEvent[]): MidiEvent[] {
  // Remove any existing end of track events
  const eventsWithoutEnd = track.filter((event) => event.type !== "endOfTrack");

  // Add a new end of track event
  return [...eventsWithoutEnd, createEndOfTrackEvent()];
}

function findUnusedChannel(midi: MidiData, usedChannels: Set<number>): number {
  // Find the first unused channel number between 0-15
  for (let channel = 0; channel < 16; channel++) {
    if (!usedChannels.has(channel)) {
      return channel;
    }
  }
  throw new Error("No unused MIDI channels available");
}

function getUsedChannels(midi: MidiData): Set<number> {
  const usedChannels = new Set<number>();
  midi.tracks.forEach((track) => {
    track.forEach((event) => {
      if ("channel" in event) {
        usedChannels.add(event.channel);
      }
    });
  });
  return usedChannels;
}

function transformMidi(
  inputData: Uint8Array,
  _forcedPanning?: boolean,
): Uint8Array {
  // Read forcedPanning directly from localStorage, fallback to false if not set
  const forcedPanning = localStorage.getItem("forcedPanning") === "true";

  const midi: MidiData = parseMidi(inputData);
  const usedChannels = getUsedChannels(midi);

  // Group tracks by channel
  const channelTracks: Map<number, number[]> = new Map();
  midi.tracks.forEach((track, trackIndex) => {
    track.forEach((event) => {
      if (isNoteOrPitchBendEvent(event)) {
        const tracks = channelTracks.get(event.channel) || [];
        if (!tracks.includes(trackIndex)) {
          tracks.push(trackIndex);
        }
        channelTracks.set(event.channel, tracks);
      }
    });
  });

  // If no multi-track channels found, return original
  const hasMultiTrackChannels = Array.from(channelTracks.values()).some(
    (tracks) => tracks.length > 1,
  );
  if (!hasMultiTrackChannels) {
    console.log("[transformMidi] skipping - no multi-track channels");
    return inputData;
  }

  // Step 1: Convert all tracks to absolute time and separate global meta events
  const mergedEvents: EnhancedMidiEvent[] = [];
  const globalMetaEvents: EnhancedMidiEvent[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    let absoluteTime = 0;
    track.forEach((event) => {
      if (event.type === "endOfTrack") return;
      absoluteTime += event.deltaTime;

      const enhancedEvent = {
        ...event,
        absoluteTime,
        originalTrack: trackIndex,
      } as EnhancedMidiEvent;

      if (isGlobalMetaEvent(event)) {
        globalMetaEvents.push(enhancedEvent);
      } else {
        mergedEvents.push(enhancedEvent);
      }
    });
  });

  mergedEvents.sort((a, b) => a.absoluteTime - b.absoluteTime);
  globalMetaEvents.sort((a, b) => a.absoluteTime - b.absoluteTime);

  // Step 2: Split into new tracks
  const newTracks: MidiEvent[][] = [];
  const processedChannels = new Set<number>();

  // Process multi-track channels
  for (const [channel, trackIndices] of channelTracks.entries()) {
    if (trackIndices.length <= 1) continue;
    processedChannels.add(channel);

    // Find an unused channel for the left hand
    const leftHandChannel = findUnusedChannel(midi, usedChannels);
    usedChannels.add(leftHandChannel); // Reserve this channel

    const baseTrackName =
      trackIndices
        .map((idx) => getTrackName(midi.tracks[idx]))
        .find((name) => name !== undefined) || "";

    // Create left/right hand tracks
    const leftHandEvents: EnhancedMidiEvent[] = [];
    const rightHandEvents: EnhancedMidiEvent[] = [];

    // Add track names
    const leftName = baseTrackName
      ? `${baseTrackName}: left hand`
      : "left hand";
    const rightName = baseTrackName
      ? `${baseTrackName}: right hand`
      : "right hand";
    rightHandEvents.push({
      ...createTrackNameEvent(rightName),
      absoluteTime: 0,
      originalTrack: trackIndices[0],
    } as EnhancedMidiEvent);
    leftHandEvents.push({
      ...createTrackNameEvent(leftName),
      absoluteTime: 0,
      originalTrack: trackIndices[1],
    } as EnhancedMidiEvent);

    // Add global meta events to both tracks
    let lastMetaTime = 0;
    globalMetaEvents.forEach((event) => {
      const deltaTime = event.absoluteTime - lastMetaTime;
      rightHandEvents.push({ ...event, deltaTime } as EnhancedMidiEvent);
      leftHandEvents.push({ ...event, deltaTime } as EnhancedMidiEvent);
      lastMetaTime = event.absoluteTime;
    });

    if (forcedPanning) {
      // Add pan right (CC #10 = 127) for right hand
      rightHandEvents.push({
        type: "controller",
        controllerType: 10,
        value: 127,
        deltaTime: 0,
        channel: channel,
        originalTrack: trackIndices[0],
        absoluteTime: 0,
      } as EnhancedMidiEvent);

      // Add pan left (CC #10 = 0) for left hand
      leftHandEvents.push({
        type: "controller",
        controllerType: 10,
        value: 0,
        deltaTime: 0,
        channel: leftHandChannel,
        originalTrack: trackIndices[1],
        absoluteTime: 0,
      } as EnhancedMidiEvent);
    }

    let rightHandLastEventTime = 0;
    let leftHandLastEventTime = 0;

    // Split events between hands
    mergedEvents.forEach((event) => {
      if (!("channel" in event)) {
        // Handle non-channel events (except global meta events which were handled earlier)
        if (!isGlobalMetaEvent(event)) {
          const deltaTimeRight = event.absoluteTime - rightHandLastEventTime;
          const deltaTimeLeft = event.absoluteTime - leftHandLastEventTime;
          rightHandEvents.push({
            ...event,
            deltaTime: deltaTimeRight,
          } as EnhancedMidiEvent);
          leftHandEvents.push({
            ...event,
            deltaTime: deltaTimeLeft,
          } as EnhancedMidiEvent);
          rightHandLastEventTime = event.absoluteTime;
          leftHandLastEventTime = event.absoluteTime;
        }
        return;
      }

      if (event.channel !== channel) return;

      const isFirstTrack = event.originalTrack === trackIndices[0];
      if (isNoteOrPitchBendEvent(event)) {
        if (isFirstTrack || event.type === "noteOff") {
          // Right hand (first track)
          const deltaTime = event.absoluteTime - rightHandLastEventTime;
          rightHandEvents.push({
            ...event,
            deltaTime,
            channel,
          } as EnhancedMidiEvent);
          rightHandLastEventTime = event.absoluteTime;
        }
        if (!isFirstTrack || event.type === "noteOff") {
          // Left hand (other tracks)
          const deltaTime = event.absoluteTime - leftHandLastEventTime;
          leftHandEvents.push({
            ...event,
            deltaTime,
            channel: leftHandChannel,
          } as EnhancedMidiEvent);
          leftHandLastEventTime = event.absoluteTime;
        }
      } else if (event.type === "programChange") {
        // Program changes stay with their respective hand
        if (isFirstTrack) {
          const deltaTime = event.absoluteTime - rightHandLastEventTime;
          rightHandEvents.push({
            ...event,
            deltaTime,
            channel,
          } as EnhancedMidiEvent);
          rightHandLastEventTime = event.absoluteTime;
        } else {
          const deltaTime = event.absoluteTime - leftHandLastEventTime;
          leftHandEvents.push({
            ...event,
            deltaTime,
            channel: leftHandChannel,
          } as EnhancedMidiEvent);
          leftHandLastEventTime = event.absoluteTime;
        }
      } else {
        // Skip existing pan control messages when forced panning is enabled
        if (
          forcedPanning &&
          event.type === "controller" &&
          event.controllerType === 10
        ) {
          return;
        }

        // Copy other channel events to both tracks
        const deltaTimeRight = event.absoluteTime - rightHandLastEventTime;
        const deltaTimeLeft = event.absoluteTime - leftHandLastEventTime;
        rightHandEvents.push({
          ...event,
          deltaTime: deltaTimeRight,
          channel,
        } as EnhancedMidiEvent);
        leftHandEvents.push({
          ...event,
          deltaTime: deltaTimeLeft,
          channel: leftHandChannel,
        } as EnhancedMidiEvent);
        rightHandLastEventTime = event.absoluteTime;
        leftHandLastEventTime = event.absoluteTime;
      }
    });

    // Clean up events and ensure track endings
    const cleanedRightHandEvents = rightHandEvents.map(
      ({ absoluteTime, originalTrack, ...event }) => event,
    );
    const cleanedLeftHandEvents = leftHandEvents.map(
      ({ absoluteTime, originalTrack, ...event }) => event,
    );

    newTracks.push(
      ensureTrackEnding(cleanedRightHandEvents),
      ensureTrackEnding(cleanedLeftHandEvents),
    );
  }

  // Add remaining tracks unchanged, ensuring they have end markers
  midi.tracks.forEach((track, trackIndex) => {
    const hasProcessedChannel = track.some(
      (event) => "channel" in event && processedChannels.has(event.channel),
    );
    if (!hasProcessedChannel) {
      newTracks.push(ensureTrackEnding(track));
    }
  });

  // Create new MIDI file
  const newMidiData: MidiData = {
    header: midi.header,
    tracks: newTracks,
  };

  // Write the modified MIDI data
  const outputData = writeMidi(newMidiData);
  return new Uint8Array(outputData);
}

export default transformMidi;
