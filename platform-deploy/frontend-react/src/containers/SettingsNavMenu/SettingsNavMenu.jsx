/* eslint-disable */
import React from 'react';
import './SettingsNavMenu.sass'
import { NavLink } from "react-router-dom";
import ProfileImg from '../../public/icons/general/svg/Profile.svg';
import PasswordImg from '../../public/icons/general/svg/Password.svg';


export const navbarList = [
    { title: 'Profile', icon: ProfileImg, shortTitle: 'Profile', path: "/settings_profile" },
    { title: 'Password', icon: PasswordImg, shortTitle: 'Password', path: "/settings_password" },
];

function SettingsNavMenuItem({ src, title, path }) {

    return (
        <NavLink
            style={{ textDecoration: 'none' }}
            to={path}
            children={({ isActive }) => {
                return (
                    <div className={"m-0 settingnav-item-container" + (isActive ? " settingnav-item-container-active" : "")}>
                        <div className={"d-flex settingnav-item my-1 mx-3 py-3" + (isActive ? " settingnav-item-active" : "")}>
                            <div className='ms-2 me-1'><img src={src} /></div>
                            <div className='nav-title ms-1 d-xl-flex flex-column justify-content-center'>{title}</div>
                        </div>
                    </div>
                );
            }} />
    );
}
export default function SettingsNavMenu() {

    return (
        <div className='settingnav-container pt-5 w-100 d-none d-lg-block'>
            {navbarList.map((item, num) => (<SettingsNavMenuItem key={item.title} src={item.icon} path={item.path} title={item.title} id={num}></SettingsNavMenuItem>))}
        </div>
    );
}


