/* eslint-disable */
import React from 'react';

import './BottomNav.css'
import {NavLink} from "react-router-dom";

export function BottomNavElement({ src, title, path}) {

    return (
        <NavLink style={{ textDecoration: 'none' , display: title == 'DIA Usage'? 'none' : 'block'  }} to={path}
                 children={({isActive}) => {
                     return (
                         <div className={"m-0 bottomnav-item-container" + (isActive ? " bottomnav-item-container-active" : "")}>
                             <div className={"d-flex flex-column bottomnav-item my-1 px-1 py-3" + (isActive ? " bottomnav-item-active" : "")}>
                                 <div className='ms-2 me-1 text-center'><img src={src}/></div>
                                 <div className='bottomnav-title ms-1 d-lg-none d-xl-flex flex-column justify-content-center'>{title}</div>
                             </div>
                         </div>
                     );
                 }}/>
    );
}



export default function BottomNav({ navbarList }) {

    return (
        <div className='bottom-nav-container w-100 d-flex d-lg-none'>
            {navbarList.map((item) => (item.shortTitle?
                <BottomNavElement key={item.title} src={item.icon} path={item.path} title={item.shortTitle} ></BottomNavElement>:""))
            }
        </div>


    );
}