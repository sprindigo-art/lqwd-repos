/* eslint-disable */
import React, { useState } from 'react';
import './Button.css';
import PropTypes from 'prop-types';

export default function Button({ buttonIcon, buttonText, buttonStyle, disabled, ...rest }) {
  const [hover, setHover] = useState(false);

  const {className, ...args} = rest;

  return (
    <button disabled={disabled}
      onMouseEnter={() => {
        setHover(true);
      }}
      onMouseLeave={() => {
        setHover(false);
      }}
      style={{
        ...buttonStyle.normal,
        ...(hover ? buttonStyle.hover : null),
      }}
      {...args}
      type="button"
      className= { "btn d-flex justify-content-center " + ( className )}
    >
      {buttonIcon? <div className='px-1'>{buttonIcon}</div>:<></>}
      <span>{buttonText}</span>
    </button>
  );
}

Button.propTypes = {
  buttonIcon: PropTypes.element,
  buttonText: PropTypes.string,
  buttonStyle: PropTypes.objectOf({
    normal: {
      color: PropTypes.string,
      backgroundColor: PropTypes.string,
      borderColor: PropTypes.string,
    },
    hover: {
      color: PropTypes.string,
      backgroundColor: PropTypes.string,
      borderColor: PropTypes.string,
    },
  }),
};

