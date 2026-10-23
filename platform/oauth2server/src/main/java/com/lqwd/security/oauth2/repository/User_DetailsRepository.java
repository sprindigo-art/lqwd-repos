package com.lqwd.security.oauth2.repository;


import com.lqwd.security.oauth2.model.security.User_Details;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface User_DetailsRepository extends JpaRepository<User_Details, UUID> {

}
