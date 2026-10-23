/* eslint-disable */

import React from 'react';
import Button from "./Button";

const style = {
    normal: {
        color: '#ffffff',
        backgroundColor: '#009EE2',
        borderColor: '#009EE2',
    },
    hover: {
        backgroundColor: '#0492ce',
        borderColor: '#038dc9',
        color: '#ffffff',

    }
}
export default function PrimaryButton({icon, disabled, text , ...rest}) {
    var {className, ...args} = rest;

    return (
        <Button
            buttonIcon={icon} disabled={disabled} buttonText={text} buttonStyle={style} className={"create-btn-primary " + (className)} {...args}
        />
    );
}
