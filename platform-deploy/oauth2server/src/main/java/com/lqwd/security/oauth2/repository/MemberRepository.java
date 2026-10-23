package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.Member;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.PagingAndSortingRepository;

import java.util.List;
import java.util.Optional;

public interface MemberRepository extends JpaRepository<Member, Long> {
        Member findByMembername(String membername);

//        Member findByMembername(String membername);
//
//        List<Member> findAll();
//
//        Page<Member> findAll(Pageable pageable);

}