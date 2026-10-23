package com.lqwd.repository;

import com.lqwd.model.entities.LndAccessUser;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import javax.persistence.Id;
import java.util.Optional;

@Repository
public interface LndAccessUserRepository extends PagingAndSortingRepository<LndAccessUser, Id> {

    @Override
    Optional<LndAccessUser> findById(Id id);

    Optional<LndAccessUser> findByApikey(String apikey);
}
