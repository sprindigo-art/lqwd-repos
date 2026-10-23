package com.lqwd.repository;

import com.lqwd.model.entities.Macaroon;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import javax.persistence.Id;
import java.util.List;
import java.util.Optional;


@Repository
public interface MacaroonRepository extends PagingAndSortingRepository<Macaroon, Id> {

    @Query(value = "SELECT p.* FROM lnd_main_v2 p where p.file_name = ?1 and  p.node_name = ?2", nativeQuery = true)
    Optional<Macaroon> findByFilenameAndNodename(@Param("filename") String filename, @Param("externalip") String externalip);

    @Query(value = "SELECT p.sfile, c.name FROM lnd_main_v2 p left join cipher_method c on c.id = p.cipher_method where p.file_name like( ?1 ) and  p.node_name = ?2", nativeQuery = true)
    Optional<Object[]> getFileAndMethodByLikeFilenameAndNodename(@Param("filename") String filename, @Param("lndNodeName") String lndNodName);


    @Query(value = "SELECT p.* FROM lnd_main_v2 p where p.file_name like( ?1 ) and  p.node_name = ?2", nativeQuery = true)
    Optional<Macaroon> findByLikeFilenameAndNodename(@Param("filename") String filename, @Param("lndNodeName") String lndNodName);

    @Query(value = "SELECT p.* FROM lnd_main_v2 p where p.watchtower = 'true'", nativeQuery = true)
    List<Macaroon> findAllWatchtowers();
}
