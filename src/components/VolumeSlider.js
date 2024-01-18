import React, { memo } from "react";

export default memo(VolumeSlider);
function VolumeSlider(props) {
  return (
    <div className="VolumeSlider">
      <span style={{ marginRight: "10px" }}>Vol</span>
      <input
        type="range"
        title={"Volume"}
        min={0}
        max={150}
        step={1}
        onChange={props.onChange}
        onDoubleClick={props.handleReset}
        onContextMenu={props.handleReset}
        value={props.value}
      ></input>
    </div>
  );
}
