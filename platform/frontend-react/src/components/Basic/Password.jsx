/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './Password.css';
import InVisibleImg from '../../public/icons/general/png/Invisible.png';
import VisibleImg from '../../public/icons/general/png/Visible.png';


export default function Password({ error, onChange, errorMsg,
                                     initialValue, label, className, handleFocus, handleBlur, autoComplete }) {
    const [visible, setVisible] = useState(false);
    const [value, setValue] = useState('');

    const handleOnVisibilityChange = (event) => {
        setVisible(!visible);
    };

    const headerOnChange = (event) => {
        event.preventDefault()
        setValue(event.target.value);
        onChange(event.target.value);

    };

    useEffect(() => {

        // Update the document title using the browser API
        if (initialValue) {
            setValue(initialValue);
        }
    }, [value]);

    return (
        <form autoComplete="none">
            <div className={'password-input ' + className} >
                {label ? <div className='m-1 password-label'>{label}</div> : <></>}
                <div className="input-group">

                    <input
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        autoComplete={ autoComplete ? autoComplete : "none"}
                        type={visible ? "text" : "password"}
                        value={value}
                        className={"form-control rounded-right " + (error ? " password-error " : "  ")}
                        style={{borderRadius: "0.375rem"}}
                        onChange={headerOnChange} required />
                    <i className={value.length == 0 ? "d-none" : "d-flex flex-column justify-content-center text-center"} onClick={handleOnVisibilityChange}>
                        {visible ? <img src={VisibleImg} /> :
                            <img src={InVisibleImg} />}
                    </i>
                </div>
                {error ? <div className='error-message'>{errorMsg}</div> : <></>}
            </div>
        </form>
    );
}
