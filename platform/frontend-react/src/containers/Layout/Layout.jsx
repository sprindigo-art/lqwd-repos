/* eslint-disable */
import React, { useEffect, useState } from "react";
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import style from './Layout.css';
import SideNavContainer from '../../components/SideNav/SideNavContainer';
import Header from '../../components/Header/HeaderContainer';
import NodeFundModal from "../FundNode/FundNode";
import CreateNode from '../CreateNode/CreateNode'
import DeleteNode from '../DeleteNode/DeleteNode'
import RestartNode from '../RestartNode/RestartNode'
import ActivateModal from '../ActivateNode/ActivateNode'
import NodeDetailsModal from '../NodeDetails/NodeDetails'
import ServerConnectionBanner from '../../containers/ServerConnectionBanner/ServerConnectionBanner'
import TransactionDetails from '../../containers/TransactionDetails/TransactionDetails'
import SubscriptionInvoiceModal from '../../containers/SubscriptionInvoiceModal/SubscriptionInvoiceModal'
import MobileWarningOverlay from "../../components/MobileWarningOverlay/MobileWarningOverlay";

import { useNavigate } from "react-router-dom";

const Layout = ({ children, mobile }) => {
  const navigation = useSelector(state => state.navigationReducer);
  const navigate = useNavigate();

  const [width, setWidth] = useState(window.innerWidth);

  const showMobileOverlay = width <= 768;

  function handleWindowSizeChange() {
    setWidth(window.innerWidth);
  }

  useEffect(() => {
    window.addEventListener('resize', handleWindowSizeChange);
    return () => {
      window.removeEventListener('resize', handleWindowSizeChange);
    }
  }, []);

  return (
    <div>
      <div className={"container-fluid home-container"}>
        {
          showMobileOverlay && (!mobile || mobile === undefined) ?
            <MobileWarningOverlay show={showMobileOverlay} handleClick={() => navigate('/')}/>
            :
            <>
              <div className="row header-container">
                <div className="dashboard-header-container d-flex justify-content-center">
                  <Header />
                </div>
              </div>
              <div className="row main-container">
                <div className="container-fluid">
                  <div className="row main-container-row">
                    <div className="sidenav-main-container d-none d-lg-block col-lg-1 col-xl-2 justify-content-start">
                      <SideNavContainer />
                    </div>

                    <div className="col-12 col-lg-11 col-xl-10 justify-content-center h-100">
                      <div className="h-100">

                        {children}

                      </div>
                    </div>
                  </div>
                </div>
                <div className="sidenav-main-container d-flex d-lg-none col-lg-1 col-xl-2 justify-content-start position-sticky bottom-0">
                  <SideNavContainer />
                </div>
              </div>
            </>
        }

      </div>
      <NodeFundModal> </NodeFundModal>
      <ActivateModal></ActivateModal>
      <NodeDetailsModal></NodeDetailsModal>
      <CreateNode></CreateNode>
      <DeleteNode></DeleteNode>
      <RestartNode></RestartNode>
      <ServerConnectionBanner></ServerConnectionBanner>
      <TransactionDetails></TransactionDetails>
      <SubscriptionInvoiceModal></SubscriptionInvoiceModal>
    </div>
  );
};

Layout.propTypes = {
  children: PropTypes.element,
};

export default Layout;
