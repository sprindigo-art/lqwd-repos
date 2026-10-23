/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './Input.css';
import { Form } from 'react-bootstrap';
import PropTypes from "prop-types";

export default function Select({ error, onChange, errorMsg, options, initialValue, label, placeholder }) {
    const [value, setValue] = useState('');


    const headerOnChange = (event) => {
        event.preventDefault()
        setValue(event.target.value);
        onChange(event.target.value);

    };

    // useEffect(() => {

    //     // Update the document title using the browser API
    //     setValue(initialValue);
    // }, [value]);

    return (
        <div className='text-input'>
            {label ? <div className='m-1 input-label'>{label}</div> : <></>}
            <Form.Select aria-label="Default select example" onChange={headerOnChange} defaultValue={initialValue}>
                {placeholder? <option selected disabled value="" >{placeholder}</option>:<></>}
                {options.map((item, num) => (<option key={num} value={item.value}  >{item.label}</option>))}
            </Form.Select>
            {error ? <div className='error-message'>{errorMsg}</div> : <></>}
        </div>
    );
}

Select.propTypes = {
    options: PropTypes.shape({
        label: PropTypes.string,
        value: PropTypes.string
    }),
};
