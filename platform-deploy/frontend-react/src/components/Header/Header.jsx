/* eslint-disable */
import React, { useState, useEffect } from 'react';
import HeaderItem from './HeaderItem'
import { useSelector, useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import './Header.css'
import { useAuth } from '../../hooks/useAuth'

import { tryLogout } from '../../containers/LoginPage/LoginPageActions'

import LogoImg from '../../public/icons/header/LQwD-Logo@4x.png';
import ProfileImg from '../../public/icons/header/Profile@4x.png';
import ProfileImgSelected from '../../public/icons/header/ProfileSelected.png';
import HamburgerImg from '../../public/icons/general/png/hamburger.png';
import CloseImg from '../../public/icons/general/png/Close.png';
import { useNavigate } from 'react-router-dom';
import HeaderNavbarList from './HeaderNavbarList'
import { navbarList, supportNavbarList } from '../../components/SideNav/SideNavContainer'

export default function Header({ headerOnClick }) {
    const user = useSelector(state => state.userReducer);
    const header = useSelector(state => state.headerReducer);
    const currentLocation = useLocation().pathname;
    const navigate = useNavigate();
    const dispatch = useDispatch();
    var { logout } = useAuth();
    const [isHamburgerClicked, setHamburger] = useState(false);
    const [showDropDown, setShowDropDown] = useState(false);

    const hamburgerClicked = () => {
        setHamburger(true);
    };
    const hamburgerClosed = () => {
        setHamburger(false);
    };

    const initialValue = [...Array(HeaderNavbarList.length)].fill(0);
    for (let index = 0; index < HeaderNavbarList.length; index++) {
        if (HeaderNavbarList[index].title === header.headerpage) {
            initialValue[index] = true;
        }
    }

    const [isActive, setIsActive] = useState(initialValue);

    const onclick = (id) => {
        let found = null;
        switch (id) {
            case 0:
                found = navbarList.find(item => item.path === currentLocation);
                if (!found) {
                    navigate(navbarList[0].path);
                }
                break;
            case 1:

                break;
            case 2:
                found = supportNavbarList.find(item => item.path === currentLocation);
                if (!found) {
                    navigate(supportNavbarList[0].path);
                }
                break;
            default:
                break;
        }
        let arr = [...Array(HeaderNavbarList.length)].fill(0);
        arr[id] = true;
        setIsActive(arr);
        headerOnClick(HeaderNavbarList[id].title);
    };

    const toggleOutsideClick = () => {
        setShowDropDown(false);
    };

    const toggleProfileDropDown = () => {
        setShowDropDown(!showDropDown);
    };

    const profileDropDownNavigate = (link) => {
      navigate(link);
    };

    const onLogout = () => {
        logout(currentLocation);
        dispatch(tryLogout());
    };

    useEffect(() => {
        const arr = [...Array(HeaderNavbarList.length)].fill(0);
        let update = false;
        for (let index = 0; index < HeaderNavbarList.length; index++) {
            if (HeaderNavbarList[index].title === header.headerpage) {
                if (isActive[index] != true){
                    update = true;
                    arr[index] = true;
                }
            }
        }
        if (update){
            setIsActive(arr);
        }

        const handleClickOutside = (event) => {
            let dropDownClass = document.querySelector(".header-profile-dropdown-container");

            let profileDropDown = document.querySelector(".header-profile-dropdown-menu");

            let profileIconClass = document.querySelector(".header-profile");

            if (dropDownClass != null) {
                if (!dropDownClass.contains(event.target) && !profileDropDown.contains(event.target) && !profileIconClass.contains(event.target)) {
                    toggleOutsideClick();
                }
            }
        };
        document.addEventListener('click', handleClickOutside, true);
        return () => {
            document.removeEventListener('click', handleClickOutside, true);
        };

    });

    return (
        <div className='d-flex flex-direction-row justify-content-center justify-content-md-start'>
            <div className='header-logo'><div className='ms-2 me-1 header-logo-img'><img src={LogoImg} /></div></div>
            <div className='flex-grow-1 d-none d-md-flex flex-direction-row justify-content-center'>
                {HeaderNavbarList.map((item, num) => (<HeaderItem key={num} title={item.title} id={num} onclick={onclick} active={isActive[num]}></HeaderItem>))}
            </div>
            <div className='ms-2 me-1 d-none d-md-flex header-profile' onClick={() => toggleProfileDropDown()}>
                <div className='header-profile-img' style={{cursor: "pointer"}}>
                    {
                        !showDropDown ?
                          <div className="header-profile-icon rounded-circle">S</div>
                          :
                          <div className="header-profile-icon-selected rounded-circle">S</div>
                    }
                </div>
                <div className={"header-profile-dropdown-container " + (!showDropDown ? "show" : "hide")} hidden={!showDropDown}>
                    <div className="header-profile-dropdown-menu">
                        {(process.env.REACT_APP_FEATURES_PROFILE_SETTINGS == 'on' )?
                        <div className="header-profile-dropdown-item" onClick={() => profileDropDownNavigate("/settings_profile")} style={{borderRadius: "8px 8px 0px 0px"}}>
                           Profile Settings
                        </div>:<></>}
                        <div className="header-profile-dropdown-item" onClick={() => profileDropDownNavigate("/subscribe")}>
                            Subscriptions
                        </div>
                        <div className="header-profile-dropdown-item logout" style={{borderRadius: "0px 0px 8px 8px"}} onClick={() => onLogout()}>
                            Log out
                        </div>
                    </div>
                </div>
            </div>

            <div className='header-hamburger'>
                <div className='ms-2 me-1' onClick={hamburgerClicked}>
                    <img src={HamburgerImg}/>
                </div>
            </div>

            <div onClick={hamburgerClosed} className={"slider-loader-hide " + (isHamburgerClicked ? ' active' : '')}>
                <div onClick={(e) => e.stopPropagation()} className={'d-flex flex-column d-lg-none mobile-sidenav ' + (isHamburgerClicked ? ' active' : '')}>
                    <div className='ms-2 me-1 close-btn' onClick={hamburgerClosed}><img src={CloseImg} /></div>
                    <div className='ms-2 me-1 item-list flex-grow-1'>
                        {HeaderNavbarList.map((item, num) => (item.mobile ? <div key={num} onClick={() => onclick(num)} className={isActive[num] ? "active" : ""}>{item.title}</div> : <></>))}
                    </div>
                    <div className='ms-2 me-1' id="account-profile">
                        <div className=''><img src={ProfileImg} /></div>
                        <span>Account Setting</span>
                    </div>
                    <div onClick={() => profileDropDownNavigate("/subscribe")} className='ms-2 me-1' style={{padding: "0px 12px", cursor: "pointer"}} id="account-profile">
                        <span>Subscriptions</span>
                    </div>
                    <div onClick={onLogout} className='ms-2 mb-4 logout'>
                        <span>Logout</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
