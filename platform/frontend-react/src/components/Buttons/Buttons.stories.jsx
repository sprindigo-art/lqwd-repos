import React from 'react';
import PrimaryButton from './PrimaryButton';
import PrimaryOutlineButton from './PrimaryOutline';
import DangerButton from './DangerButton';
import InheritButton from './InheritButton'
import DangerOutlineButton from "./DangerOutlineButton";
import BasicButton from "./BasicButton";

export default {
  title: 'Lqwd Buttons/Button',
  component: PrimaryButton,
};

export const primary = () => {
  const text = 'Fund me';
  return (
    <PrimaryButton
      text={text}
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          fill="currentColor"
          className="bi bi-plus"
          viewBox="0 0 16 16"
        >
          <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z" />
        </svg>
      }
    />
  );
};

export const primaryOutline = () => {
  const text = 'Fund me';
  return (
    <PrimaryOutlineButton
      text={text}
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          fill="currentColor"
          className="bi bi-plus"
          viewBox="0 0 16 16"
        >
          <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z" />
        </svg>
      }
    />
  );
};

export const danger = () => {
  const text = 'Delete';
  return (
    <DangerButton
      text={text}
    />
  );
};

export const dangerOutline = () => {
  const text = 'Delete Outline';
  return (
    <DangerOutlineButton
      text={text}
    />
  );
};

export const basicButton = () => {
  const text = 'Basic Button';
  return (
    <BasicButton
      text={text}
    />
  );
};
export const inherit = () => {
  const text = 'Delete';
  return (
    <div>
      <div className='my-2' style={{ width: '100%', background: 'red', color: 'blue' }}>
        <div>
          the text is blue in this div, so should the color of button
        </div>
        <InheritButton
          text={text}
        />

      </div>
      <div className='my-2' style={{ width: '100%', background: 'green', color: 'white' }}>
        <div>
          the text is white in this div, so should the color of button
        </div>
        <InheritButton
          text={text}
        />

      </div>
    </div>
  );
};


