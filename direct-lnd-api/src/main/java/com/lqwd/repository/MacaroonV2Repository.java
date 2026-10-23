package com.lqwd.repository;

import com.lqwd.model.MacaroonV2;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import javax.persistence.Id;
import java.util.List;
import java.util.Optional;


@Repository
public interface MacaroonV2Repository extends PagingAndSortingRepository<MacaroonV2, Id> {

    @Query(value = "SELECT p.* FROM lnd_main_v2 p where p.file_name = ?1 and  p.host_name = ?2", nativeQuery = true)
    Optional<MacaroonV2> findByFilenameAndHostname(@Param("filename") String filename, @Param("hostname") String hostname);

    @Query(value = "SELECT p.* FROM lnd_main_v2 p where p.file_name like( ?1 ) and  p.host_name = ?2", nativeQuery = true)
    Optional<MacaroonV2> findByLikeFilenameAndHostname(@Param("filename") String filename, @Param("hostname") String hostname);


    @Query(value = "SELECT p.* FROM lnd_main_v2 p where p.watchtower = 'true'", nativeQuery = true)
    List<MacaroonV2> findAllWatchtowers();

}
