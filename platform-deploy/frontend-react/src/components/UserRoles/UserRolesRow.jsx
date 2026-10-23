/* eslint-disable */
import React from 'react';
import UserRolesItem from "./UserRolesItem";


export default function UserRolesRow({sharedUserList}) {


  return (
    <>
      {sharedUserList.map((item) => (
        <UserRolesItem username={item.username}
                       email={item.email}
                       node={item.node}
                       status={item.status}
                       admin={item.admin}
                       manager={item.manager}
                       auditor={item.auditor} />
      ))}
    </>
  );
}
