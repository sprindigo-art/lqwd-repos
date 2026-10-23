package com.lqwd.repository;

import com.lqwd.model.Macaroon;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import javax.persistence.Id;
import java.util.Optional;


@Repository
public interface MacaroonRepository extends PagingAndSortingRepository<Macaroon, Id> {

    @Query(value = "SELECT p.* FROM lnd_main p where p.file_name = ?1 and  p.externalip = ?2", nativeQuery = true)
    Optional<Macaroon> findByFilenameAndExternalip(@Param("filename") String filename, @Param("externalip") String externalip);

    @Query(value = "SELECT p.* FROM lnd_main p where p.file_name like( ?1 ) and  p.externalip = ?2", nativeQuery = true)
    Optional<Macaroon> findByLikeFilenameAndExternalip(@Param("filename") String filename, @Param("externalip") String externalip);


}
