/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useSnackbar } from 'notistack';
import './CreateNode.css'
// actions
import { getTierInfo } from "../Subscription/SubscriptionActions";
// components
import CreateNodeModal from '../../components/Node/CreateNodeModal'
import { requestCreatePersonalLNDNode } from '../../requests/Node';
import NotificationDuration from 'NotificationDuration'
import { requestGetActiveSubscription, requestGetTierInfo, requestGetUserStatus } from "../../requests/Subscription";
import { hideCreateNodeModal } from '../../containers/CreateNode/CreateNodeActions'

const CreateNode = () => {
    const dispatch = useDispatch();
    const createNodeReducer = useSelector(state => state.createNodeReducer);
    const subscriptionReducer = useSelector(state => state.subscriptionReducer);

    const handleClose = (error, data) => {
        dispatch(hideCreateNodeModal());
    }

    const handleHide = () => {
        dispatch(hideCreateNodeModal());
    }

    useEffect(() => {
        dispatch(getTierInfo());
      }, []);


    return (
        <>
            <CreateNodeModal
                show={createNodeReducer.showModal}
                handleClose={handleClose}
                handleHide={handleHide}
                subscriptions={subscriptionReducer.subscriptions}
                dispatch={dispatch}
                createNodeReducer={createNodeReducer}
            />
        </>
    );
};

export default CreateNode;
