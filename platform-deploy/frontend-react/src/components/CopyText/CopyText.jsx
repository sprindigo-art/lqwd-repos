/* eslint-disable */
import React, {useState} from 'react';
import './CopyText.css'
import Tooltip from "react-bootstrap/Tooltip";
import {OverlayTrigger} from "react-bootstrap";



export default function CopyText({text, classNames}) {

    const [show, setShow] = useState(false);

    const renderTooltip = props => (
        <Tooltip {...props} id="copy-tooltip">Copied</Tooltip>
    );

    function copy(text) {
        navigator.clipboard.writeText(text).then(r => {
                setShow(true)
                setTimeout(function() { setShow(false); }, 1000)
            }
        )
    }

    return (
        <div className={'d-sm-inline-flex copy-text-container ' + classNames}>
            <OverlayTrigger placement="top" show={show} overlay={renderTooltip}>
                <div className="p-2 copy-text">{text}</div>
            </OverlayTrigger>
            <div className="p-2 .flex-column justify-content-end  ms-auto">

                <svg id="copy" onClick={() => copy(text)} width="16" height="16" viewBox="0 0 16 16" fill="currentColor"
                     xmlns="http://www.w3.org/2000/svg">
                    <path
                        d="M2 0.5C1.17125 0.5 0.5 1.17125 0.5 2V11.75C0.5 12.164 0.836 12.5 1.25 12.5C1.664 12.5 2 12.164 2 11.75V2H11.75C12.164 2 12.5 1.664 12.5 1.25C12.5 0.836 12.164 0.5 11.75 0.5H2ZM5 3.5C4.17125 3.5 3.5 4.17125 3.5 5V14C3.5 14.8287 4.17125 15.5 5 15.5H14C14.8287 15.5 15.5 14.8287 15.5 14V5C15.5 4.17125 14.8287 3.5 14 3.5H5ZM5 5H14V14H5V5Z"
                        fill="currentColor"/>
                </svg>

            </div>

        </div>
    );
}
