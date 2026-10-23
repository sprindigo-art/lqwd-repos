/* eslint-disable */
import React, { useEffect, useState } from 'react';
import UserRolesTable from "../../components/UserRoles/UserRolesTable";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import './SharedNodeAccess.css';
import AuthorizeModal from "../../components/Auth/AuthorizeModal/AuthorizeModal";
import AddUserModal from "../../components/AddUserModal/AddUserModal";
import { useSnackbar } from "notistack";
import { useDispatch, useSelector } from "react-redux";
import { processSelectItemNode } from "../../utils/utils";
import { getSharedNodeList, getSharedUserList } from "./ShareNodeAcessActions";
import {
  requestDeleteUserNodeAccess,
  requestInviteNodeAccess,
  requestUpdateUserNodeAccess
} from "../../requests/ShareNodeAccess";
import NotificationDuration from "../../NotificationDuration";
import { resetUserData, setUserData } from "./ShareNodeAcessActions";

const SharedNodeAccess = () => {

  const { enqueueSnackbar, closeSnackbar } = useSnackbar();
  const dispatch = useDispatch();

  const nodeReducer = useSelector(state => state.nodeReducer);

  const shareReducer = useSelector(state => state.shareNodeAccessReducer);

  let nodeList = processSelectItemNode(nodeReducer.nodeList)

  const [addUserModal, showAddUserModal] = useState(false);

  const [addUserData, setAddUserData] = useState({});

  const [authorizeModal, showAuthorizeModal] = useState(false);

  const [selectedNode, setSelectedNode] = useState({});

  const [updateUser, setUpdateUser] = useState(false);

  const [deleteUserAuth, setDeleteUserAuth] = useState(false);

  const roles = [
    {label:"Admin", value:"ADMIN"},
    {label:"Supervisor", value:"SUPERVISOR"},
    {label:"Auditor", value:"AUDITOR"}
  ];

  const handleAddUserClick = () => {
    showAddUserModal(true);
  };

  const handleConfirmAddUser = (email, node, role, password) => {
    console.log(email, node, role, password);
    setUpdateUser(false);
    setDeleteUserAuth(false);
    setSelectedNode(JSON.parse(node));
    showAddUserModal(false);
    showAuthorizeModal(true);
    dispatch(setUserData(email, role, JSON.parse(node).lndNodeName, password))
  };

  const handleUpdateUserRole = (email, node, role) => {
    console.log(email, node, role);

    showAuthorizeModal(true);
    setUpdateUser(true);
    setDeleteUserAuth(false);
    dispatch(setUserData(email, role, node))
  };

  const handleDeleteUser = (email, node, role) => {
    console.log(email, node, role);

    showAuthorizeModal(true);
    setUpdateUser(false);
    setDeleteUserAuth(true);
    dispatch(setUserData(email, role, node))
  };

  const handleAuthorizeAddUser = (password, passphrase) => {

    shareReducer.addUserInfo.password = password;
    shareReducer.addUserInfo.passphrase = passphrase;

    console.log(shareReducer);

    requestInviteNodeAccess(shareReducer.addUserInfo).then(function(response) {
      if (response.status === 200){
        enqueueSnackbar(JSON.parse(response.object).message, { variant: 'success', autoHideDuration: NotificationDuration });
        showAuthorizeModal(false);
      }else if (response.status === 400) {
        enqueueSnackbar(JSON.parse(response.object).message, { variant: 'error', autoHideDuration: NotificationDuration });
        showAuthorizeModal(false);
      }else{
        enqueueSnackbar(response.message, { variant: 'error', autoHideDuration: NotificationDuration });
        showAuthorizeModal(false);
      }
      dispatch(getSharedUserList())
    }).catch(function(err) {
      console.log(err);
      enqueueSnackbar("Failed to Share Node Access with User, Please Try Agan Later.", { variant: 'error', autoHideDuration: NotificationDuration });
      showAuthorizeModal(false);
    });

    dispatch(resetUserData())

  };

  const handleAuthorizeUpdateUser = (password, passphrase) => {

    shareReducer.addUserInfo.password = password;
    shareReducer.addUserInfo.passphrase = passphrase;

    console.log(shareReducer);

    requestUpdateUserNodeAccess(shareReducer.addUserInfo).then(function(response) {
      if (response.status === 200){
        enqueueSnackbar(JSON.parse(response.object).message, { variant: 'success', autoHideDuration: NotificationDuration });
        showAuthorizeModal(false);
      }else{
        enqueueSnackbar(response.message, { variant: 'error', autoHideDuration: NotificationDuration });
        showAuthorizeModal(false);
      }
      dispatch(getSharedUserList())
    }).catch(function(err) {
      console.log(err);
      enqueueSnackbar("Failed to Update User Role, Please Try Agan Later.", { variant: 'error', autoHideDuration: NotificationDuration });
      showAuthorizeModal(false);
    });

    dispatch(resetUserData())

  };

  const handleAuthorizeDeleteUser = (password, passphrase) => {

    shareReducer.addUserInfo.password = password;
    shareReducer.addUserInfo.passphrase = passphrase;

    console.log(shareReducer);

    requestDeleteUserNodeAccess(shareReducer.addUserInfo).then(function(response) {
      if (response.status === 200){
        enqueueSnackbar(JSON.parse(response.object).message, { variant: 'success', autoHideDuration: NotificationDuration });
        showAuthorizeModal(false);
        setDeleteUserAuth(false);
      }else{
        enqueueSnackbar(response.message, { variant: 'error', autoHideDuration: NotificationDuration });
        showAuthorizeModal(false);
        setDeleteUserAuth(false);
      }
      dispatch(getSharedUserList())
    }).catch(function(err) {
      console.log(err);
      enqueueSnackbar("Failed to Delete User Access, Please Try Agan Later.", { variant: 'error', autoHideDuration: NotificationDuration });
      showAuthorizeModal(false);
      setDeleteUserAuth(false);
    });

    dispatch(resetUserData())

  };

  console.log(nodeReducer);
  console.log(shareReducer);
  useEffect(() => {
    dispatch(getSharedNodeList())
    dispatch(getSharedUserList())
  },[]);

  return (
    <>
      <div className="shared-node-access-container">
        <div className="shared-node-access-header">
          <div className="shared-node-access-title">
            Shared Node Access
          </div>

          <div className="shared-node-access-add-user">
            <PrimaryButton text={"Add User"}
                           icon={
                                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M8.25 2.25V8.25H2.25V9.75H8.25V15.75H9.75V9.75H15.75V8.25H9.75V2.25H8.25Z" fill="white"/>
                                  </svg>
                                }
                           onClick={() => handleAddUserClick()}/>
          </div>

        </div>
        <div className="shared-node-access-table-container">
          <div className="shared-node-access-table-title">
            User Roles and Permissions
          </div>
          <div className="shared-node-access-table">
            <UserRolesTable
              sharedUserList={shareReducer.sharedUserList}
              roleList={roles}
              handleUpdate={handleUpdateUserRole}
              handleDelete={handleDeleteUser}>
            </UserRolesTable>
          </div>
        </div>
      </div>
      <AddUserModal
        show={addUserModal}
        nodeList={nodeList}
        onConfirm={handleConfirmAddUser}
        handleHide={() => showAddUserModal(false)}
        roleList={roles} />
      <AuthorizeModal
        show={authorizeModal}
        isNonCustodial={selectedNode.isNonCustodial === undefined ? true : selectedNode.isNonCustodial}
        handleConfirm={updateUser ? handleAuthorizeUpdateUser : handleAuthorizeAddUser}
        handleHide={() => showAuthorizeModal(false)}
        goBack={() => showAuthorizeModal(false)}
      ></AuthorizeModal>
      <AuthorizeModal
        show={deleteUserAuth}
        isNonCustodial={selectedNode.isNonCustodial === undefined ? true : selectedNode.isNonCustodial}
        handleConfirm={handleAuthorizeDeleteUser}
        handleHide={() => setDeleteUserAuth(false)}
        goBack={() => setDeleteUserAuth(false)}
      ></AuthorizeModal>
    </>
  );

};

export default SharedNodeAccess;