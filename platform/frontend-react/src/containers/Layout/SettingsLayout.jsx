/* eslint-disable */
import React from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import './SettingsLayout.css';
import Header from '../../components/Header/HeaderContainer';
import ServerConnectionBanner from '../../containers/ServerConnectionBanner/ServerConnectionBanner'
import SettingsNavMenu from '../../containers/SettingsNavMenu/SettingsNavMenu'
import SettingsMobileNavMenu from '../../containers/SettingsNavMenu/SettingsMobileNavMenu'
import SettingsGeneralInfo from '../../containers/SettingsGeneralInfo/SettingsGeneralInfo'

const Layout = ({ children }) => {
  const navigation = useSelector(state => state.navigationReducer);

  return (
    <div>
      <div className="container-fluid settings-container">
        <div className="row settings-header-container">
          <div className="dashboard-header-container d-flex justify-content-center">
            <Header />
          </div>
        </div>
        <div className="row settings-center-container ">
          <div className="">
            <div className="justify-content-center d-flex flex-column">
              <div className=" settings-general">
                <SettingsGeneralInfo />
              </div>
              <div className='d-block d-lg-none'>
                <SettingsMobileNavMenu></SettingsMobileNavMenu>
              </div>
              <div className="d-flex flex-row flex-grow-1">
                <div className="d-none d-lg-block settings-leftnav">
                  <SettingsNavMenu />
                </div>
                <div className="justify-content-center h-100 container settings-main pt-2">
                  <div className="h-100">

                      {children}
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
        {/* <div className="row settings-footer-menu d-lg-none">
          bottom menu
        </div> */}
      </div>
      <ServerConnectionBanner></ServerConnectionBanner>
    </div>
  );
};

Layout.propTypes = {
  children: PropTypes.element,
};

export default Layout;
