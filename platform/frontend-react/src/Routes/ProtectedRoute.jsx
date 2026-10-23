/* eslint-disable */
import React from 'react'
import { useSelector } from 'react-redux'
import { useDispatch } from "react-redux";
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import connect from "../push";
import { navbarList, supportNavbarList } from '../components/SideNav/SideNavContainer'
import HeaderNavbarList from '../components/Header/HeaderNavbarList';
import { changeHeaderPage } from '../components/Header/HeaderActions'
import { CheckDataVersionAndClearIfObsolete } from 'managers/DataManager/DataManager'

export const ProtectedRoute = ({ children }) => {
  const { user, logout } = useAuth();
  const userReducer = useSelector(state => state.userReducer);
  const dispatch = useDispatch();
  const currentLocation = useLocation().pathname;
  const headerpage = useSelector(state => state.headerReducer.headerpage);

  CheckDataVersionAndClearIfObsolete();

  // if (userReducer.user == null) {
  //   logout();
  //   return <Navigate to={`/login?redirectTo=${prevLocation}`} />;
  // }
  if (!user || window.localStorage.getItem('user') == null) {
    //TODO: disabling this feature for now, no redirection at all. use redirectPath for user to land on their last visited page later
    // let redirectPath = window.localStorage.getItem('redirectPath');
    // let toLoginPagePath = redirectPath ? `/login?redirectTo=${redirectPath}` : '/login'
    let toLoginPagePath = '/login';
    // user is not authenticated
    return <Navigate to={toLoginPagePath} />;
  }

  // //check if header is not corresponded to URI ******START******
  let found = navbarList.find(item => item.path === currentLocation);
  if (found && headerpage != HeaderNavbarList[0].title) {
    dispatch(changeHeaderPage(HeaderNavbarList[0].title));
  }
  else{
    found = supportNavbarList.find(item => item.path === currentLocation);
    if (found && headerpage != HeaderNavbarList[2].title) {
      dispatch(changeHeaderPage(HeaderNavbarList[2].title));
    }
  }
  // //check if header is not corresponded to URI ******END******


  connect().then(() => { }).catch(err => { console.log(err) });

  return children;
};
