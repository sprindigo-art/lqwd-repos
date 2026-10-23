/* eslint-disable */
import React from 'react';
import PageButtons from "./PageButtons";

export default {
  title: 'LQWD Basic/ Pagination',
  component: PageButtons,
};

export const main = () => {
  const currentPage = 1;

  const totalPages = 3;

  return (
    <div>
      <PageButtons id={"example1"} name={"example1"} currentPage={currentPage} totalPages={totalPages}></PageButtons>
    </div>
  )
}