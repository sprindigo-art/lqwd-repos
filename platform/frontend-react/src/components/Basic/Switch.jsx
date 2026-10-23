/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './Switch.css';


export default function Switch({ error, onChange, errorMsg, label, description,name, disabled, initialValue }) {
    const [value, setValue] = useState(false);


    const headerOnChange = (event) => {
        setValue(!value);
        event.target.value = !value
        onChange(event);

    };
    
    useEffect(() => {
        if (initialValue){
            setValue(initialValue);
        }
    }, []);


    return (
        <div>
            <div className='switch-input d-flex flex-row'>
                {label ?
                <div className='m-1 flex-grow-1'>
                    <div className='label'>{label}</div>
                {description ? <div className='description'>{description}</div> : <></>}
                </div> : <></>}
                <div className="form-check form-switch">
                    <input type="checkbox" disabled={disabled} checked={value} name={name} className={"form-check-input rounded-right shadow-none " + (error ? " password-error " : "  ")} onClick={headerOnChange} />
                </div>
            </div>

            {error ? <div className='error-message'>{errorMsg}</div> : <></>}

        </div>
    );
}
