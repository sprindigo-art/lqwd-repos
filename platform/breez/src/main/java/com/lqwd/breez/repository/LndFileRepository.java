package com.lqwd.breez.repository;

import com.lqwd.breez.model.LndNodeFile;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import javax.persistence.Id;
import java.util.Optional;


@Repository
public interface LndFileRepository extends PagingAndSortingRepository<LndNodeFile, Id> {

    @Query(value = "SELECT p.* FROM lnd_main_v2 p where p.file_name = ?1 and  p.node_name = ?2", nativeQuery = true)
    Optional<LndNodeFile> findByFilenameAndNodeName(@Param("filename") String filename, @Param("lndNodeName") String lndNodName);

}
