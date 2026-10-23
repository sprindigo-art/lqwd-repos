/* eslint-disable */
import React from 'react';
import './HeaderContainer.css'

export default function SideNav({ src, title, active, onclick, id, classNames }) {

    return (
        <div className={"d-flex header-item py-3 mx-4 " + (active ? " header-item-active " : " ") + (classNames? classNames : ' ') + (title=='Market Stats'?' d-none ' : ' ' )} onClick={() => onclick(id)}>
            <div className='ms-1 d-flex header-title flex-column justify-content-center'>{title}</div>
        </div>
    );
}
