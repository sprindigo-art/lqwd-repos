/* eslint-disable */
import React from 'react';
import './SideNavItem.css'
import { NavLink } from "react-router-dom";

export default function SideNav({ src, title, path }) {

    return (
        <NavLink 
            style={{ textDecoration: 'none', display: (title == 'DIA Usage' && process.env.REACT_APP_FEATURES_SUPPORT_DIA_USAGE !== 'on')? 'none' : 'block' }} 
            to={path}
            {...(path === '/' ? {end : true} : {})}
            children={({ isActive }) => {
                return (
                    <div className={"m-0 sidenav-item-container" + (isActive ? " sidenav-item-container-active" : "")}>
                        <div className={"d-flex sidenav-item my-1 mx-3 py-3" + (isActive ? " sidenav-item-active" : "")}>
                            <div className='ms-2 me-1'><img src={src} /></div>
                            <div className='nav-title ms-1 d-lg-none d-xl-flex flex-column justify-content-center'>{title}</div>
                        </div>
                    </div>
                );
            }} />
    );
}
