/* eslint-disable */
import React, { useEffect, useState } from "react";
import './RefreshButton.css';
import processIcon from '../../public/icons/general/svg/Process.svg';
export default function RefreshButton({label, handleOnClick, width, height, rotate }) {

  const doNothing = () => {
    console.log("Still Processing");
  };
  return (
    <>
      <div className={label !== null && label !== "" && label !== undefined ? "d-flex flex-row gap-2" : ""}>
        {label !== null && label !== "" && label !== undefined ? <div className={"refresh-button-label"}>{label}</div> : <></>}
        <img src={processIcon} width={width} height={height} onClick={rotate ? doNothing: handleOnClick} className={rotate ? "refresh-rotate" : ""}/>
      </div>
    </>
  );
}