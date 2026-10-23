/* eslint-disable */
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { changeHeaderPage } from './HeaderActions';
import HeaderMain from './Header'
import './Header.css'


export default function HeaderContainer() {
    // const sidenav = useSelector(state => state.sidenavReducer);
    const dispatch = useDispatch();

    const headerOnClick = (page) => {
        dispatch(changeHeaderPage(page))
    };

    return (
        <div className='w-100'>
            <HeaderMain headerOnClick={headerOnClick}></HeaderMain>
        </div>
    );
}
