/* eslint-disable */
import React from 'react';
import UserRolesTable from "./UserRolesTable";
import UserRolesItem from "./UserRolesItem";
import UserRolesRow from "./UserRolesRow";

export default {
  title: 'Components/User Roles Table',
  component: UserRolesTable
};

const sharedUserListTmp = [
  {
    username: "User 1",
    email: "user1@example.com",
    node: "Node 1",
    status:"Active",
    admin: true,
    auditor: false,
    manager: true,
  },
  {
    username: "User 2",
    email: "user1@example.com",
    node: "Node 3",
    status:"Inactive",
    admin: false,
    auditor: false,
    manager: false,
  },
  {
    username: "User 3",
    email: "user3@example.com",
    node: "Node 2",
    status:"Pending",
    admin: false,
    auditor: true,
    manager: false,
  }
];

export const primary = () => {
  return (
    <>
      <UserRolesTable sharedUserList={sharedUserListTmp}></UserRolesTable>
    </>
  );
};

export const item = () => {
  return (
    <>
      <UserRolesItem
        username={"User 1"}
        email={"user1@example.com"}
        node={"Node 1"}
        status={"Active"}
        admin={true}
        auditor={false}
        manager={true} />

    </>
  );
};


export const rows = () => {
  return (
    <>
      <UserRolesRow sharedUserList={sharedUserListTmp}></UserRolesRow>
    </>
  );
};