/* eslint-disable */
import React from 'react'
import { createContext, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocalStorage } from './useLocalStorage';
import connect from "../push";
import { useDispatch } from "react-redux";
import { verifyGetEmail } from "../containers/VerifyPage/VerifyPageActions";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useLocalStorage('user', null);
  const [redirectPath, setRedirectPath] = useLocalStorage('redirectPath', null);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  // call this function when you want to authenticate the user
  const login = async data => {
    setUser(data);
    setRedirectPath(null);
    dispatch(verifyGetEmail());
  };

  // call this function to sign out logged in user
  const logout = (redirectPath) => {
    setUser(null);
    setRedirectPath(redirectPath);
  };

  const value = useMemo(
    () => ({
      user,
      login,
      logout,
    }),
    [user]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  return useContext(AuthContext);
};
