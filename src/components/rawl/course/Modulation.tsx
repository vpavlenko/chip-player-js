import * as React from "react";
import TagSearch from "../TagSearch";
import { Chapter } from "./Course";

const Modulation: Chapter = ({ sequencer, analyses }) => {
  return (
    <>
      <TagSearch tag="modulation:parallel_keys" analyses={analyses} />
      <TagSearch tag="chord:Picardy_third" analyses={analyses} />
      <TagSearch tag="modulation:contrast" analyses={analyses} />
      <TagSearch tag="modulation:often" analyses={analyses} />
      <TagSearch tag="modulation:relative_major" analyses={analyses} />
      <TagSearch tag="modulation:up_at_the_end" analyses={analyses} />
      <TagSearch tag="modulation:back_down" analyses={analyses} />
    </>
  );
};

export default Modulation;
