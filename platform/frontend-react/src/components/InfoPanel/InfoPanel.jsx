/* eslint-disable */
import React from 'react';
import './InfoPanel.css'
import IdeaIcon from '../../public/icons/general/png/Idea.png';
import ErrorIcon from '../../public/icons/general/png/Error.png';
import InfoIcon from '../../public/icons/general/png/Info.png';

const setIconImg = (warn,error, info, success) => {
    if (error) return ErrorIcon;
    if (warn) return IdeaIcon;
    if (info) return InfoIcon;
    if (success) return InfoIcon;

    return IdeaIcon;

}


export default function InfoPanel({warn,error, info, success, text, imgObj, className}) {
    return (
        <div className={'text-panel my-2 d-flex ' + (warn?' text-panel-warn ' :' ') + (error?' text-panel-error ' :' ') + (info?' text-panel-info ':' ') + (success?' text-panel-success ':' ') + className}>
            <div className='me-2'><img src={imgObj == null ? setIconImg(warn,error, info) : imgObj}></img></div>
            <div className='text'>{text}</div>
        </div>
    );
}
