/* eslint-disable */
import React from 'react';
import MobileWarningOverlay from "./MobileWarningOverlay";
import { useNavigate } from "react-router-dom";

export default {
  title: 'LQWD Components/Non-Mobile Friendly Warning',
  component: MobileWarningOverlay,
};

export const primary = () => {
   const exampleClick = () => {
     console.log("clicked");
   };

  return (
    <>
      <MobileWarningOverlay show={true} handleClick={() => exampleClick()}/>
    </>
  )
}
