/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './Input.css';


export default function Input({ error, onChange, errorMsg,
                                  initialValue, name, label, placeHolder, disabled }) {
    const [value, setValue] = useState('');


    const headerOnChange = (event) => {
        event.preventDefault()
        setValue(event.target.value);
        onChange(event);

    };

    useEffect(() => {

        // Update the document title using the browser API
        setValue(initialValue);
    }, [
        value
    ]);

    return (
        <div className='text-input'>
            {label ? <div className='m-1 input-label'>{label}</div> : <></>}
            <div className="input-group">
                <input autoComplete="none" placeholder={placeHolder} type="text"
                       name={name} value={value}
                       className={"form-control rounded-right " + (error ? " password-error " : "  ")} onChange={headerOnChange} required disabled={disabled} />
            </div>
            {error ? <div className='error-message'>{errorMsg}</div> : <></>}
        </div>
    );
}
