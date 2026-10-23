/* eslint-disable */

import React from 'react';
import Button from "./Button";

const style = {
  normal: {

  },
  hover: {


  }
}
export default function BasicButton({icon, text , ...rest}) {
  var {className, ...args} = rest;

  return (
    <Button
      buttonIcon={icon} buttonText={text} buttonStyle={style} className={"btn-light " + (className)} {...args}
    />
  );
}
