package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.Authority;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.UUID;

@Repository
public interface AuthorityRepository extends PagingAndSortingRepository<Authority, UUID> {

    Collection<Authority> findByName(String name);
}
