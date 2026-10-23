/* eslint-disable */
import React, { useState } from "react";
import './RadioButton.css';

export default function RadioButton({id, name, label, selected, value, handleChange}){

  return (
    <>
      <div className={(selected ? "custom-radio-button-select" : "custom-radio-button")}>
        <label className="custom-radio-button-container">
          <input id={id} type="radio" name={name} value={value} checked={selected} onChange={handleChange}/>
          <span className="custom-radio-button-checkmark align-self-center"></span>
        </label>
        {label}
      </div>
    </>
  );
}