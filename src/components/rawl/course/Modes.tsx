import * as React from "react";
import TagSearch from "../TagSearch";
import ChordClouds from "./ChordClouds";
import { Chapter, S } from "./Course";

const Modes: Chapter = ({ sequencer, analyses }) => {
  return (
    <>
      <ChordClouds chords={["i", "IV"]} />
      <h3>Dorian (shuttle?)</h3>

      <ul>
        <li>
          <S artist="MIDI/Type O Negative" song="Love You to Death.mid" /> -
          dorian
        </li>
        <li>
          <S artist="MIDI/Typically Tropical" song="Barbados.mid" /> dorian
          relative shuttle after modulation
        </li>
        <li>
          <S artist="MIDI/U2" song="A Celebration.mid" />
        </li>
        <li>
          <S
            artist="MIDI/UB40"
            song="(I Can't Help) Falling In Love With You.mid"
          />
        </li>
        <li>
          <S artist="MIDI/Us3" song="Cantaloop.mid" />
        </li>
        <li>
          <S artist="MIDI/Bob Marley" song="Jammin'.mid" />
        </li>
        <li>
          <S artist="MIDI/Zucchero" song="Senza Una Donna.7.mid" />
        </li>
        <li>
          <S artist="MIDI/Tasmin Archer" song="Sleeping Satellite.mid" /> - ii
          in minor, dorian solo, mixed dorian/natural
        </li>
      </ul>
      <TagSearch tag="scale:dorian" analyses={analyses} />
      <h3>iadd6</h3>
      <ul>
        <li>
          <S artist="MIDI/Vaughan Sarah" song="Fever.mid" />
        </li>
      </ul>
      <h3>Hexatonic minor</h3>
      <ul>
        <li>
          <S artist="MIDI/Uriah Heep" song="Lady in Black.mid" /> - two chords
        </li>
      </ul>
      <h3>Functionality - shuttle</h3>
      <ul>
        <li>
          <S artist="MIDI/Type O Negative" song="Love You to Death.mid" /> -
          dorian shuttle
        </li>
      </ul>
      <h3>Mixolydian shuttle</h3>
      <ul>
        <li>
          <S
            artist="MIDI/Village People"
            song="Five O'clock in the Morning.mid"
          />
        </li>
        <li>
          <S artist="MIDI/Talk Talk" song="It's My Life.mid" />
        </li>
        <li>
          <S artist="MIDI/Technohead" song="I Wanna Be a Hippy.mid" />
        </li>
        <li>
          <S artist="MIDI/Terence Trent D'Arby" song="Wishing Well.mid" />
        </li>
      </ul>
    </>
  );
};

export default Modes;
