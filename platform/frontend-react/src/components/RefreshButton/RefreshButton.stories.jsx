/* eslint-disable */
import React, { useState } from "react";
import RefreshButton from './RefreshButton';

export default {
  title: 'Components/Refresh Button',
  component: RefreshButton,
};


export const primary = () => {

  const [isCLicked, setIsClicked] = useState(false);

  const exampleClick = () => {
    console.log("clicked");
    setIsClicked(!isCLicked);
  };
  return (
    <div>
      <RefreshButton width={"24px"} height={"24px"} handleOnClick={() => exampleClick()} rotate={isCLicked}/>
    </div>
  );
};