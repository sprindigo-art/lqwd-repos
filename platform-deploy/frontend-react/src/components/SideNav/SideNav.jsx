/* eslint-disable */
import React from 'react';
import Element from './SideNavElement'


import './SideNav.css'

export default function SideNav({ navbarList }) {

    return (
        <div className='pt-5 w-100 d-none d-lg-block'>
            {navbarList.map((item, num) => (<Element key={item.title} src={item.icon} path={item.path} title={item.title} id={num}></Element>))}
        </div>
    );
}

