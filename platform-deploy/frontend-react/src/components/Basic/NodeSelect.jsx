/* eslint-disable */
import React, { useState} from 'react';
import './Input.css';
import { Form } from 'react-bootstrap';
import PropTypes from "prop-types";

export default function NodeSelect({ error, onChange, errorMsg, options, label, placeholder, nodeName }) {
    const [value, setValue] = useState('');

    const headerOnChange = (event) => {
        event.preventDefault()
        setValue(event.target.value);
        onChange(event.target.value);

    };


    return (
        <div className='text-input'>
            {label ? <div className='m-1 input-label'>{label}</div> : <></>}
            <Form.Select className={"empty-node-text"} disabled={options.length < 1} aria-label="Default select example" onChange={headerOnChange}>
                <option disabled={true} selected={true} value="">
                    {placeholder}
                </option>
                {options.map((item, num) => (
                  <option key={num} value={item.value} selected={nodeName != null && nodeName === item.label}>
                    {item.label}{(item.balance !== undefined && item.balance !== null) ? " - Confirmed Balance " + parseInt(item.balance).toLocaleString() : ""}
                      {item.shared ? " (SHARED NODE)" : ""}
                  </option>
                ))}
            </Form.Select>
            {error ? <div className='error-message'>{errorMsg}</div> : <></>}
            {options < 1 ? <div className="empty-node-text shadow p-2 bg-white rounded">Looks like you haven’t created a node yet, <a href={"/nodes"}>create now</a></div> : <></>}
        </div>
    );
}


NodeSelect.propTypes = {
    options: PropTypes.shape({
        label: PropTypes.string,
        value: PropTypes.string
    }),
};
