/* eslint-disable */

import React from 'react';
import Button from "./Button";

const style = {
    normal: {

    },
    hover: {


    }
}
export default function PrimaryOutlineButton({icon, text , ...rest}) {
    var {className, ...args} = rest;

    return (
        <Button
            buttonIcon={icon} buttonText={text} buttonStyle={style} className={"btn-primary-outline " + (className)} {...args}
        />
    );
}
