/* eslint-disable */
import React from 'react';
import Switch from "../Basic/Switch";
import trashIcon from "../../public/icons/general/svg/TrashRed.svg";
import "./UserRolesItem.css";

export default function UserRolesItem({username, email, node, status, admin, manager, auditor, handleToggleStatus, handleDeactivate}) {

  return (
    <>
      <div className="user-role-item-container">
        <div className="user-role-item-row">
          <div className="user-role-item-col">
            <div className="user-role-item-username">
              {username}
            </div>
          </div>
          <div className="user-role-item-col">
            <div className="user-role-item-email">
              {email}
            </div>
          </div>
          <div className="user-role-item-col">
            <div className="user-role-item-node">
              {node}
            </div>
          </div>
          <div className="user-role-item-col">
            <div className="user-role-item-status">
              {status}
            </div>
          </div>
          <div className="user-role-item-col">
            <div className="user-role-item-status-toggle">
              <Switch label={"Admin"} initialValue={admin}></Switch>
            </div>
          </div>
          <div className="user-role-item-col">
            <div className="user-role-item-status-toggle">
              <Switch label={"Supervisor"} initialValue={manager}></Switch>
            </div>
          </div>
          <div className="user-role-item-col">
            <div className="user-role-item-status-toggle">
              <Switch label={"Auditor"} initialValue={auditor}></Switch>
            </div>
          </div>
          <div className="user-role-item-col">
            <div className="user-role-item-action">
              <img src={trashIcon}/>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
