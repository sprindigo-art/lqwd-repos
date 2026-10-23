/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './Input.css';


export default function TextArea({ error, onChange, errorMsg, initialValue, label }) {
    const [value, setValue] = useState('');


    const headerOnChange = (event) => {
        event.preventDefault()
        setValue(event.target.value);
        onChange(event.target.value);

    };

    useEffect(() => {

        // Update the document title using the browser API
        setValue(initialValue);
    }, [
        value
    ]);

    return (
        <div className='text-input'>
            {label ? <div className='input-label'>{label}</div> : <></>}
            <div className="input-group">
                <textarea autoComplete="none" type="text" value={value} className={"form-control rounded-right " + (error ? " password-error " : "  ")} onChange={headerOnChange} required />
            </div>
            {error ? <div className='error-message'>{errorMsg}</div> : <></>}
        </div>
    );
}
